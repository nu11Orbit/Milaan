"""
api/routes_retry_llm.py
Retry Pass 5 for matches that were pending LLM enrichment due to provider rate-limiting.

Endpoints:
  GET  /api/batches/{batch_id}/pending-llm        — list all pending records
  POST /api/batches/{batch_id}/retry-llm          — re-run Pass 5 for all pending records

Design principles:
  • Only Pass 5 is re-run — Passes 1-4 scores are already computed and stored.
  • Idempotency: each match is keyed by match_id. If Pass 5 already succeeded
    (pending_llm_enrichment=False), it is silently skipped.
  • Respects the circuit breaker: a still-rate-limited provider will fail gracefully
    and leave pending_llm_enrichment=True for the next retry attempt.
  • Each successful retry appends a new AuditLogEntry so the audit trail is complete.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException

from app.engine.pass5_llm_adjudicator import (
    _build_user_message,
    _SYSTEM_PROMPT,
    should_run_pass5,
)
from app.engine.confidence_scorer import score
from app.engine.schemas import CandidateMatch, InvoiceView, ScoreContribution, TxnView
from app.llm.router import LLMRouter
from app.models.audit_log_entry import AuditLogEntry
from app.models.bank_transaction import BankTransaction
from app.models.invoice import Invoice
from app.models.match import Match

log = logging.getLogger(__name__)
router = APIRouter()


# ── List pending matches ───────────────────────────────────────────────────────

@router.get("/batches/{batch_id}/pending-llm")
async def list_pending_llm(batch_id: str, run_id: Optional[str] = None):
    """
    List all matches that are pending LLM enrichment (both providers were
    rate-limited during the original run).
    """
    query_args = [Match.batch_id == batch_id, Match.pending_llm_enrichment == True]
    if run_id:
        query_args.append(Match.run_id == run_id)

    pending = await Match.find(*query_args).to_list()

    return {
        "batch_id": batch_id,
        "pending_count": len(pending),
        "message": (
            f"{len(pending)} records pending LLM enrichment — "
            "deterministic score shown; will auto-upgrade when quota resets."
            if pending else
            "No records pending LLM enrichment."
        ),
        "matches": [
            {
                "match_id":            m.match_id,
                "confidence_score":    m.confidence_score,
                "confidence_band":     m.confidence_band,
                "pending_llm_reason":  m.pending_llm_reason,
                "line_items": [
                    {"txn_id": li.txn_id, "invoice_id": li.invoice_id}
                    for li in m.line_items
                ],
            }
            for m in pending
        ],
    }


# ── Retry endpoint ─────────────────────────────────────────────────────────────

@router.post("/batches/{batch_id}/retry-llm")
async def retry_pending_llm(batch_id: str, run_id: Optional[str] = None):
    """
    Re-run Pass 5 (LLM adjudication only) for all matches still flagged
    pending_llm_enrichment in this batch.

    Safe to call multiple times — already-enriched matches are skipped.
    Respects the circuit breaker: if providers are still rate-limited, the
    flag stays True and the endpoint returns how many succeeded vs stayed pending.
    """
    query_args = [Match.batch_id == batch_id, Match.pending_llm_enrichment == True]
    if run_id:
        query_args.append(Match.run_id == run_id)

    pending = await Match.find(*query_args).to_list()
    if not pending:
        return {"message": "No pending LLM enrichments — nothing to retry.", "retried": 0, "still_pending": 0}

    router_llm = LLMRouter()
    succeeded = 0
    still_pending = 0

    for match in pending:
        try:
            result = await _retry_one_match(match, router_llm)
            if result:
                succeeded += 1
            else:
                still_pending += 1
        except Exception as e:
            log.error(f"Unexpected error retrying {match.match_id}: {e}")
            still_pending += 1

    return {
        "batch_id":      batch_id,
        "retried_total": len(pending),
        "succeeded":     succeeded,
        "still_pending": still_pending,
        "message": (
            f"{succeeded}/{len(pending)} enriched. "
            f"{still_pending} still pending — providers may still be rate-limited."
            if still_pending else
            f"All {succeeded} records successfully enriched with LLM narrative."
        ),
    }


async def _retry_one_match(match: Match, router_llm: LLMRouter) -> bool:
    """
    Re-run Pass 5 for a single match document.
    Returns True if LLM succeeded and match was updated, False if still rate-limited.
    """
    # Idempotency guard — another concurrent retry may have already cleared this
    if not match.pending_llm_enrichment:
        return True

    # Reconstruct lightweight views from the match's line items
    # We only need txn_id + invoice_id to rebuild the prompt context
    txn_id = next((li.txn_id for li in match.line_items if li.txn_id), None)
    inv_id = next((li.invoice_id for li in match.line_items if li.invoice_id), None)

    if not txn_id or not inv_id:
        # Exception-only match (no invoice) — nothing to enrich
        await match.set({Match.pending_llm_enrichment: False})
        return True

    # Fetch the source documents
    txn_doc = await BankTransaction.find_one(BankTransaction.txn_id == txn_id)
    inv_doc = await Invoice.find_one(Invoice.invoice_id == inv_id)

    if not txn_doc or not inv_doc:
        log.warning(f"Cannot retry {match.match_id} — source documents missing")
        await match.set({Match.pending_llm_enrichment: False,
                         Match.pending_llm_reason: "Source documents deleted — retry skipped"})
        return True

    # Rebuild a minimal TxnView + InvoiceView for the prompt
    from decimal import Decimal
    txn_view = TxnView(
        txn_id=txn_doc.txn_id,
        merchant_id=txn_doc.merchant_id,
        txn_date=txn_doc.txn_date,
        amount=txn_doc.amount,
        direction=txn_doc.direction,
        narration=txn_doc.narration,
        channel=getattr(txn_doc, "channel", None),
        reference_number=getattr(txn_doc, "reference_number", None),
    )
    inv_view = InvoiceView(
        invoice_id=inv_doc.invoice_id,
        merchant_id=inv_doc.merchant_id,
        counterparty_name=inv_doc.counterparty_name,
        invoice_date=inv_doc.invoice_date,
        base_amount=inv_doc.base_amount,
        total_amount=inv_doc.total_amount,
        expected_net_amount=inv_doc.expected_net_amount,
        tds_amount=getattr(inv_doc, "tds_amount", None),
        tds_section=getattr(inv_doc, "tds_section", None),
        cgst_amount=getattr(inv_doc, "cgst_amount", Decimal("0")),
        sgst_amount=getattr(inv_doc, "sgst_amount", Decimal("0")),
        igst_amount=getattr(inv_doc, "igst_amount", Decimal("0")),
        reference_number=getattr(inv_doc, "reference_number", None),
        status=inv_doc.status,
    )

    # Rebuild a minimal CandidateMatch with the stored final score
    # (Passes 1-4 contributions are not re-run — their combined effect
    #  is captured in match.confidence_score)
    candidate = CandidateMatch(
        invoice_id=inv_id,
        txn_id=txn_id,
        score=match.confidence_score,
        contributions=[
            ScoreContribution(
                source="stored_passes_1_4",
                delta=match.confidence_score,
                reason=f"Score from passes 1-4 stored at run time: {match.confidence_score:.1f}",
                rule_fired=True,
            )
        ],
    )

    # Call LLM router — Pass 5 only
    user_msg = _build_user_message(txn_view, inv_view, candidate)
    response, provider, raw_text, both_rate_limited = await router_llm.adjudicate(
        system_prompt=_SYSTEM_PROMPT,
        user_message=user_msg,
    )

    if both_rate_limited:
        # Still rate-limited — leave flag set, do not update score
        log.warning(f"Retry for {match.match_id} still rate-limited")
        return False

    # Apply delta and re-band
    from app.core.config import get_settings
    settings = get_settings()
    delta = response.effective_delta()
    new_score = max(0.0, min(100.0, match.confidence_score + delta))

    if new_score >= settings.threshold_auto_accept:
        new_band = "auto_accept"
    elif new_score >= settings.threshold_review:
        new_band = "review"
    else:
        new_band = "reject"

    exp_source = "llm" if provider in ("gemini", "groq") else match.explanation_source

    # Append audit log entry for this retry
    audit_entry = AuditLogEntry(
        log_id=f"LOG-{uuid.uuid4().hex[:12]}",
        match_id=match.match_id,
        batch_id=match.batch_id,
        run_id=match.run_id,
        pass_name="pass5_llm_retry",
        score_delta=delta,
        score_after=new_score,
        reasoning_text=f"LLM retry succeeded via {provider}. {response.explanation}",
        raw_llm_response=raw_text,
        llm_provider=provider,
        llm_model=None,
        llm_fallback_used=(provider == "groq"),
        llm_both_failed=False,
        timestamp=datetime.utcnow(),
    )
    await audit_entry.insert()

    # Update the Match atomically
    await match.set({
        Match.confidence_score:       new_score,
        Match.confidence_band:        new_band,
        Match.explanation_text:       response.explanation[:280],
        Match.explanation_source:     exp_source,
        Match.pending_llm_enrichment: False,
        Match.pending_llm_reason:     None,
    })

    log.info(
        f"Retry enriched {match.match_id}: {provider} delta={delta:+.1f} "
        f"score {match.confidence_score:.1f}→{new_score:.1f} band={new_band}"
    )
    return True
