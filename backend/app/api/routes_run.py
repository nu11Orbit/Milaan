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

# In-process SSE queues keyed by run_id — sufficient for single-worker demo
_sse_queues: dict[str, asyncio.Queue] = {}
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
    queue  = asyncio.Queue()
    _sse_queues[run_id] = queue

    # Start the reconciliation in the background
    background_tasks.add_task(_run_in_background, batch_id, run_id, queue)

    return RunResponse(
        batch_id=batch_id,
        run_id=run_id,
        stream_url=f"/api/batches/{batch_id}/run/{run_id}/stream",
        message=f"Reconciliation started. Connect to stream_url for live progress.",
    )


async def _run_in_background(batch_id: str, run_id: str, queue: asyncio.Queue):
    """Fetch docs and run the full pipeline, feeding SSE events into the queue."""
    try:
        txn_docs = await BankTransaction.find(BankTransaction.batch_id == batch_id).to_list()
        inv_docs  = await Invoice.find(Invoice.batch_id == batch_id).to_list()

        summary = await run_reconciliation(
            batch_id=batch_id,
            run_id=run_id,
            txn_docs=txn_docs,
            invoice_docs=inv_docs,
            sse_queue=queue,
        )
        _run_summaries[run_id] = summary
    except Exception as e:
        log.exception(f"Reconciliation run {run_id} crashed: {e}")
        import json
        await queue.put(f"data: {json.dumps({'error': str(e), 'done': True})}\n\n")
    finally:
        # Sentinel to signal the SSE generator to close
        await queue.put(None)


# ── SSE stream ────────────────────────────────────────────────────────────────

async def _sse_generator(run_id: str) -> AsyncGenerator[str, None]:
    queue = _sse_queues.get(run_id)
    if queue is None:
        yield "data: {\"error\": \"Run not found\"}\n\n"
        return

    while True:
        item = await queue.get()
        if item is None:
            # Run complete — clean up
            _sse_queues.pop(run_id, None)
            break
        yield item


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
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",   # disable Nginx buffering for SSE
        },
    )


# ── Run status (for polling fallback) ─────────────────────────────────────────

@router.get("/batches/{batch_id}/run/{run_id}")
async def get_run_status(batch_id: str, run_id: str):
    """Get the summary of a completed run (polling fallback if SSE isn't used)."""
    summary = _run_summaries.get(run_id)
    if summary:
        return {"status": "complete", **summary}
    # Check if matches exist in DB
    count = await Match.find(
        Match.batch_id == batch_id,
        Match.run_id   == run_id,
    ).count()
    if count > 0:
        return {"status": "complete", "match_count": count}
    if run_id in _sse_queues:
        return {"status": "running"}
    return {"status": "not_found"}
