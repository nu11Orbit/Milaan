"""
api/routes_run.py
POST /api/batches/{batch_id}/run  — trigger reconciliation
GET  /api/batches/{batch_id}/run/{run_id}/stream — SSE live progress

SSE format (one JSON event per txn, then a done event):
  data: {"idx": 1, "total": 62, "txn_id": "TXN-001", "band": "auto_accept", "score": 92.4, ...}

  data: {"done": true, "auto_accept": 45, "review": 10, "exceptions": 7, "total": 62}
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from typing import AsyncGenerator

from fastapi import APIRouter, BackgroundTasks, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.models.bank_transaction import BankTransaction
from app.models.invoice import Invoice
from app.models.match import Match
from app.engine.orchestrator import run_reconciliation

log = logging.getLogger(__name__)
router = APIRouter()

# In-process SSE storage keyed by run_id — supports replay and concurrent subscribers
class RunStream:
    def __init__(self, run_id: str, batch_id: str):
        self.run_id = run_id
        self.batch_id = batch_id
        self.events: list[str] = []
        self.notifier = asyncio.Event()
        self.is_done = False
        self.summary: dict | None = None

    def push(self, event_str: str):
        self.events.append(event_str)
        self.notifier.set()

    def finish(self, summary: dict | None = None):
        self.is_done = True
        self.summary = summary
        self.notifier.set()


class _QueueAdapter:
    """Adapter so orchestrator's `await sse_queue.put(event)` writes to RunStream."""
    def __init__(self, stream: RunStream):
        self.stream = stream

    async def put(self, item: str | None):
        if item is not None:
            self.stream.push(item)


_run_streams: dict[str, RunStream] = {}
_run_summaries: dict[str, dict] = {}


# ── Trigger run ───────────────────────────────────────────────────────────────

class RunResponse(BaseModel):
    batch_id: str
    run_id:   str
    stream_url: str
    message: str


@router.post("/batches/{batch_id}/run", response_model=RunResponse)
async def trigger_run(batch_id: str, background_tasks: BackgroundTasks):
    """
    Trigger a reconciliation run for a batch.
    Returns a run_id and the SSE stream URL to connect to for live progress.
    The run executes asynchronously in the background.
    """
    # Verify batch exists
    txn_count = await BankTransaction.find(BankTransaction.batch_id == batch_id).count()
    inv_count  = await Invoice.find(Invoice.batch_id == batch_id).count()
    if txn_count == 0 and inv_count == 0:
        raise HTTPException(404, f"Batch '{batch_id}' not found or empty")

    run_id = f"RUN-{uuid.uuid4().hex[:10]}"
    stream = RunStream(run_id, batch_id)
    _run_streams[run_id] = stream

    # Start the reconciliation in the background
    background_tasks.add_task(_run_in_background, batch_id, run_id, stream)

    return RunResponse(
        batch_id=batch_id,
        run_id=run_id,
        stream_url=f"/api/batches/{batch_id}/run/{run_id}/stream",
        message=f"Reconciliation started. Connect to stream_url for live progress.",
    )


async def _run_in_background(batch_id: str, run_id: str, stream: RunStream):
    """Fetch docs and run the full pipeline, feeding SSE events into the RunStream."""
    try:
        txn_docs = await BankTransaction.find(BankTransaction.batch_id == batch_id).to_list()
        inv_docs  = await Invoice.find(Invoice.batch_id == batch_id).to_list()

        queue_adapter = _QueueAdapter(stream)
        summary = await run_reconciliation(
            batch_id=batch_id,
            run_id=run_id,
            txn_docs=txn_docs,
            invoice_docs=inv_docs,
            sse_queue=queue_adapter,
        )
        _run_summaries[run_id] = summary
        stream.finish(summary)
    except Exception as e:
        log.exception(f"Reconciliation run {run_id} crashed: {e}")
        import json
        err_event = f"data: {json.dumps({'error': True, 'error_message': str(e), 'done': True, 'auto_accept': 0, 'review': 0, 'exceptions': 0, 'total': 0})}\n\n"
        stream.push(err_event)
        stream.finish({"status": "error", "error": str(e)})


# ── SSE stream ────────────────────────────────────────────────────────────────

async def _sse_generator(run_id: str) -> AsyncGenerator[str, None]:
    import json
    # 1. Immediately yield connection event so HTTP 200 headers flush to client & proxy
    yield f"data: {json.dumps({'status': 'connected', 'run_id': run_id, 'message': 'Streaming connection established'})}\n\n"

    stream = _run_streams.get(run_id)
    if stream is None:
        # If run already completed before stream connected (or server restarted), replay matches from DB
        matches = await Match.find(Match.run_id == run_id).to_list()
        if matches:
            for m_idx, m in enumerate(matches):
                invs = [li.invoice_id for li in m.line_items if li.invoice_id]
                txn_id = m.line_items[0].txn_id if m.line_items and m.line_items[0].txn_id else f"TXN-{m_idx+1}"
                amount = str(sum(li.allocated_amount for li in m.line_items if li.allocated_amount))
                yield f"data: {json.dumps({'idx': m_idx + 1, 'total': len(matches), 'match_id': m.match_id, 'txn_id': txn_id, 'amount': amount, 'band': m.confidence_band, 'score': m.confidence_score, 'match_type': m.match_type, 'invoices': invs, 'explanation': m.explanation_text or ''})}\n\n"
            yield f"data: {json.dumps({'done': True, 'total': len(matches), 'auto_accept': len([m for m in matches if m.confidence_band == 'auto_accept']), 'review': len([m for m in matches if m.confidence_band == 'review']), 'exceptions': len([m for m in matches if m.confidence_band in ('reject', 'exception')])})}\n\n"
            return
        yield f"data: {json.dumps({'error': 'Run not found or completed', 'done': True, 'total': 0})}\n\n"
        return

    cursor = 0
    while True:
        # Drain all available events
        while cursor < len(stream.events):
            yield stream.events[cursor]
            cursor += 1

        if stream.is_done and cursor >= len(stream.events):
            break

        stream.notifier.clear()
        try:
            await asyncio.wait_for(stream.notifier.wait(), timeout=3.0)
        except asyncio.TimeoutError:
            # Heartbeat comment to keep Render / Cloudflare proxy connection warm
            yield ": keepalive\n\n"


@router.get("/batches/{batch_id}/run/{run_id}/stream")
async def stream_run(batch_id: str, run_id: str):
    """
    SSE endpoint for live reconciliation progress.
    Connect immediately after POST /api/batches/{id}/run.
    Each event is a JSON object. The final event has done=true.
    """
    return StreamingResponse(
        _sse_generator(run_id),
        media_type="text/event-stream",
        headers={
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",   # disable Nginx/Cloudflare buffering
            "Access-Control-Allow-Origin": "https://milaan-seven.vercel.app",
            "Access-Control-Allow-Credentials": "true",
        },
    )


# ── Run status (for polling fallback) ─────────────────────────────────────────

@router.get("/batches/{batch_id}/run/{run_id}")
async def get_run_status(batch_id: str, run_id: str):
    """Get the summary of a completed run (polling fallback if SSE isn't used)."""
    stream = _run_streams.get(run_id)
    if stream is not None:
        if stream.is_done:
            return {"status": "complete", **(stream.summary or {})}
        return {"status": "running"}

    summary = _run_summaries.get(run_id)
    if summary:
        return {"status": "complete", **summary}

    # If not in memory, check if matches exist in DB from previous completed run
    matches = await Match.find(
        Match.batch_id == batch_id,
        Match.run_id   == run_id,
    ).to_list()
    if matches:
        auto_count = sum(1 for m in matches if m.confidence_band == "auto_accept")
        review_count = sum(1 for m in matches if m.confidence_band == "review")
        exc_count = sum(1 for m in matches if m.confidence_band in ("reject", "exception"))
        return {
            "status": "complete",
            "batch_id": batch_id,
            "run_id": run_id,
            "total": len(matches),
            "auto_accept": auto_count,
            "review": review_count,
            "exceptions": exc_count,
        }

    return {"status": "not_found"}
