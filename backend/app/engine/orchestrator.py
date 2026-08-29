"""
engine/orchestrator.py
Batch Reconciliation Orchestrator
===================================

Wires all 5 passes together for a single batch run.

Flow per transaction:
  1. Narrow candidates (counterparty + date window + amount range)
  2. Pre-pass filter: zero/noise txns → exception bucket
  3. Duplicate detection (Case 15) → exception bucket
  4. Pass 1 → Pass 2 → Pass 3 in sequence; first confident hit wins
  5. If still unresolved: Pass 4 (split/batch subset-sum)
  6. Near-duplicate check (Case 8): top-2 too close → force review
  7. Pass 5 (LLM) if review-band or flagged
  8. Confidence scorer → final decision
  9. Write Match + AuditLogEntry to DB
 10. Emit SSE event to connected frontend client

Assignment:
  After all txns processed, run a greedy bipartite assignment pass to ensure
  no invoice is double-matched (descending by confidence, first claim wins).

Idempotency:
  Re-running the same (batch_id, run_id) deletes previous matches first so
  the run is safe to retry without duplicate records.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import date, timedelta
from decimal import Decimal
from typing import AsyncGenerator, Dict, List, Optional, Set

from app.core.config import get_settings
from app.engine import candidate_filter
from app.engine.pass1_rules import run_pass1
from app.engine.pass2_fuzzy import run_pass2
from app.engine.pass3_embedding import run_pass3
from app.engine.pass4_split_matcher import (
    SplitMatchResult,
    detect_duplicate_txn,
    run_pass4_batch,
    run_pass4_split,
)
from app.engine.pass5_llm_adjudicator import run_pass5, should_run_pass5
from app.engine.confidence_scorer import ConfidenceResult, near_duplicate_check, score
from app.engine.fellegi_sunter import FSModel
from app.engine.hungarian_matcher import apply_hungarian_to_batch
from app.engine.schemas import CandidateMatch, InvoiceView, TxnView
from app.llm.router import LLMRouter
from app.models.audit_log_entry import AuditLogEntry
from app.models.match import Match, MatchLineItem

log = logging.getLogger(__name__)


# ── View builders (DB model → engine schema) ─────────────────────────────────

def _invoice_to_view(inv) -> InvoiceView:
    return InvoiceView(
        invoice_id=inv.invoice_id,
        merchant_id=inv.merchant_id,
        counterparty_name=inv.counterparty_name,
        invoice_date=inv.invoice_date,
        base_amount=inv.base_amount,
        total_amount=inv.total_amount,
        expected_net_amount=inv.expected_net_amount,
        tds_amount=getattr(inv, "tds_amount", None),
        tds_section=getattr(inv, "tds_section", None),
        cgst_amount=getattr(inv, "cgst_amount", Decimal("0")),
        sgst_amount=getattr(inv, "sgst_amount", Decimal("0")),
        igst_amount=getattr(inv, "igst_amount", Decimal("0")),
        reference_number=getattr(inv, "reference_number", None),
        status=inv.status,
    )


def _txn_to_view(txn) -> TxnView:
    return TxnView(
        txn_id=txn.txn_id,
        merchant_id=txn.merchant_id,
        txn_date=txn.txn_date,
        amount=txn.amount,
        direction=txn.direction,
        channel=getattr(txn, "channel", None),
        narration=txn.narration,
        reference_number=getattr(txn, "reference_number", None),
    )


# ── Noise / pre-pass filter ────────────────────────────────────────────────────

_NOISE_THRESHOLD_RUPEES = Decimal("10")  # txns below ₹10 → noise bucket

def _is_noise(txn: TxnView) -> bool:
    return txn.amount < _NOISE_THRESHOLD_RUPEES


# ── Audit log helper ──────────────────────────────────────────────────────────

async def _write_audit(
    match_id: str,
    batch_id: str,
    pass_name: str,
    score_delta: Optional[float],
    score_after: Optional[float],
    reasoning: Optional[str],
    raw_llm: Optional[str] = None,
    llm_provider: Optional[str] = None,
    llm_model: Optional[str] = None,
    llm_fallback: bool = False,
    llm_both_failed: bool = False,
) -> None:
    entry = AuditLogEntry(
        log_id=f"LOG-{uuid.uuid4().hex[:12]}",
        match_id=match_id,
        batch_id=batch_id,
        pass_name=pass_name,
        score_delta=score_delta,
        score_after=score_after,
        reasoning_text=reasoning,
        raw_llm_response=raw_llm,
        llm_provider=llm_provider if llm_provider in ("gemini", "groq") else None,
        llm_model=llm_model,
        llm_fallback_used=llm_fallback,
        llm_both_failed=llm_both_failed,
    )
    await entry.insert()


# ── SSE event builder ──────────────────────────────────────────────────────────

def _sse_event(data: dict) -> str:
    import json
    return f"data: {json.dumps(data)}\n\n"


# ── Per-txn matching logic ─────────────────────────────────────────────────────

async def _match_one_txn(
    txn_view: TxnView,
    inv_views: List[InvoiceView],
    inv_map: Dict[str, InvoiceView],
    all_txn_views: List[TxnView],
    batch_id: str,
    run_id: str,
    router: LLMRouter,
    settings,
    claimed_invoices: Set[str],
    fs_model: Optional[FSModel] = None,
    candidate_scores_collector: Optional[Dict[Tuple[str, str], float]] = None,
) -> Optional[Match]:
    """
    Run the full 5-pass pipeline for one transaction.
    Returns a Match Beanie document (not yet inserted — caller inserts after
    bipartite assignment to avoid claiming invoices that get taken by higher-confidence matches).
    """
    # ── Pre-pass: noise filter ─────────────────────────────────────────────────
    if _is_noise(txn_view):
        match_id = f"MATCH-{uuid.uuid4().hex[:12]}"
        return Match(
            match_id=match_id, batch_id=batch_id, run_id=run_id,
            match_type="exception", confidence_score=0.0, confidence_band="reject",
            line_items=[MatchLineItem(txn_id=txn_view.txn_id, allocated_amount=txn_view.amount)],
            exception_reason_category="noise_below_floor",
            exception_reason_detail=f"Txn amount ₹{txn_view.amount} below noise threshold ₹{_NOISE_THRESHOLD_RUPEES}",
            threshold_snapshot={},
        )

    # ── Pre-pass: duplicate detection ─────────────────────────────────────────
    dup_of = detect_duplicate_txn(txn_view, all_txn_views)
    if dup_of:
        match_id = f"MATCH-{uuid.uuid4().hex[:12]}"
        return Match(
            match_id=match_id, batch_id=batch_id, run_id=run_id,
            match_type="exception", confidence_score=0.0, confidence_band="reject",
            line_items=[MatchLineItem(txn_id=txn_view.txn_id, allocated_amount=txn_view.amount)],
            exception_reason_category="duplicate_detected",
            exception_reason_detail=f"Likely duplicate of {dup_of} — same amount, narration, within 3 days",
            threshold_snapshot={},
        )

    # ── Narrow candidates ──────────────────────────────────────────────────────
    available_invs = [iv for iv in inv_views if iv.invoice_id not in claimed_invoices]
    narrow = candidate_filter.narrow(txn_view, available_invs, settings)

    if not narrow:
        match_id = f"MATCH-{uuid.uuid4().hex[:12]}"
        return Match(
            match_id=match_id, batch_id=batch_id, run_id=run_id,
            match_type="exception", confidence_score=0.0, confidence_band="reject",
            line_items=[MatchLineItem(txn_id=txn_view.txn_id, allocated_amount=txn_view.amount)],
            exception_reason_category="no_candidate_found",
            exception_reason_detail="No open invoice within date window / amount range for this merchant",
            threshold_snapshot={},
        )

    narrow_map = {iv.invoice_id: iv for iv in narrow}

    # ── Pass 1 → 2 → 3 ───────────────────────────────────────────────────────
    candidates = run_pass1(txn_view, narrow)
    candidates = run_pass2(txn_view, candidates, narrow_map)
    if any(c.resolved_by is None for c in candidates):
        candidates = run_pass3(txn_view, candidates, narrow_map, settings)

    if candidate_scores_collector is not None:
        for c in candidates:
            if c.invoice_id and not c.is_exception:
                candidate_scores_collector[(txn_view.txn_id, c.invoice_id)] = c.score

    top = candidates[0] if candidates else None

    # ── Pass 4 (split/batch) if still unresolved ──────────────────────────────
    split_result: Optional[SplitMatchResult] = None
    if top is None or top.resolved_by is None:
        # Try split: many txns → this invoice candidate
        if top:
            split_result = run_pass4_split(
                inv_map.get(top.invoice_id),
                [t for t in all_txn_views if t.txn_id != txn_view.txn_id
                 and t.txn_id not in claimed_invoices],
                settings,
            )
        # Try batch: this txn → many invoices
        if split_result is None or split_result.match_type == "no_match":
            batch_result = run_pass4_batch(txn_view, narrow, settings)
            if batch_result.match_type not in ("no_match", "flagged_for_llm"):
                split_result = batch_result

    # ── Near-duplicate escalation (Case 8) ───────────────────────────────────
    force_review = False
    if len(candidates) >= 2:
        if near_duplicate_check(candidates[0].score, candidates[1].score):
            force_review = True

    # ── Fellegi-Sunter score ──────────────────────────────────────────────────
    # Compute independently from heuristic passes — no circular dependency.
    # fs_score=None means "FS not available" and scorer falls back to heuristic-only.
    fs_score: Optional[float] = None
    if top and not top.is_exception and fs_model is not None:
        inv_for_fs = inv_map.get(top.invoice_id)
        if inv_for_fs:
            try:
                fs_score = fs_model.compute_score(txn_view, inv_for_fs, settings)
            except Exception as e:
                log.warning(f"FS scoring failed for {txn_view.txn_id}/{top.invoice_id}: {e}")

    # ── Confidence score pre-LLM ──────────────────────────────────────────────
    flagged = split_result.flagged_for_llm if split_result else False
    req_review = (split_result.requires_human_review if split_result else False) or force_review

    cr: ConfidenceResult
    if top:
        cr = score(top, requires_human_review=req_review, flagged_for_llm=flagged,
                   fs_score=fs_score, settings=settings)
    else:
        # No candidate at all even after Pass 4
        match_id = f"MATCH-{uuid.uuid4().hex[:12]}"
        return Match(
            match_id=match_id, batch_id=batch_id, run_id=run_id,
            match_type="exception", confidence_score=0.0, confidence_band="reject",
            line_items=[MatchLineItem(txn_id=txn_view.txn_id, allocated_amount=txn_view.amount)],
            exception_reason_category="no_candidate_found",
            exception_reason_detail="All passes exhausted — no match candidate found",
            threshold_snapshot={},
        )

    # ── Pass 5 (LLM) ──────────────────────────────────────────────────────────
    llm_response, llm_provider, llm_raw, both_rate_limited = None, "none", "", False
    if should_run_pass5(top, req_review, flagged, settings):
        inv_for_llm = inv_map.get(top.invoice_id)
        if inv_for_llm:
            llm_response, llm_provider, llm_raw, both_rate_limited = await run_pass5(
                txn_view, inv_for_llm, top, router
            )
            # Re-score with LLM delta already applied to top.score via candidate.add()
            cr = score(
                top,
                llm_delta=0.0,   # delta already applied inside run_pass5
                fs_score=fs_score,
                requires_human_review=req_review,
                flagged_for_llm=flagged,
                settings=settings,
            )

    # ── Build Match document ───────────────────────────────────────────────────
    match_id = f"MATCH-{uuid.uuid4().hex[:12]}"

    if split_result and split_result.match_type in ("split_many_to_one", "batch_one_to_many", "partial"):
        mtype = split_result.match_type
        line_items = [
            MatchLineItem(
                txn_id=tid if mtype == "split_many_to_one" else txn_view.txn_id,
                invoice_id=top.invoice_id if mtype == "split_many_to_one" else iid,
                allocated_amount=split_result.allocated_amounts.get(
                    tid if mtype == "split_many_to_one" else iid, txn_view.amount
                ),
            )
            for tid in (split_result.txn_ids or [txn_view.txn_id])
            for iid in (split_result.invoice_ids or [top.invoice_id])
        ]
        explanation = split_result.explanation
    else:
        mtype = top.match_type or "one_to_one"
        line_items = [MatchLineItem(
            txn_id=txn_view.txn_id,
            invoice_id=top.invoice_id,
            allocated_amount=txn_view.amount,
        )]
        explanation = cr.explanation

    exp_source = (
        "llm" if llm_provider in ("gemini", "groq")
        else top.resolved_by.replace("pass1_", "rules_engine")
                             .replace("pass2_", "fuzzy")
                             .replace("pass3_", "embedding")
        if top and top.resolved_by else "none"
    )

    match = Match(
        match_id=match_id, batch_id=batch_id, run_id=run_id,
        match_type=mtype,
        confidence_score=cr.final_score,
        confidence_band=cr.decision,
        explanation_text=explanation[:280],
        explanation_source=exp_source,
        line_items=line_items,
        threshold_snapshot=cr.threshold_snapshot,
        exception_reason_category=top.exception_reason_category if top.is_exception else None,
        # Pending LLM enrichment: only when BOTH providers were rate-limited.
        # Not set for genuine insufficient_evidence — that's a content signal, not infra failure.
        pending_llm_enrichment=both_rate_limited,
        pending_llm_reason=(
            "Both Gemini and Groq rate-limited — LLM narrative pending quota reset"
            if both_rate_limited else None
        ),
    )

    return match, top, cr, llm_provider, llm_raw


# ── Main orchestrator ─────────────────────────────────────────────────────────

async def run_reconciliation(
    batch_id: str,
    run_id: str,
    txn_docs: list,
    invoice_docs: list,
    sse_queue: Optional[asyncio.Queue] = None,
) -> dict:
    """
    Run a full reconciliation batch.

    Parameters
    ----------
    batch_id      : Identifier for this batch.
    run_id        : Unique run ID for idempotency.
    txn_docs      : List of BankTransaction Beanie documents.
    invoice_docs  : List of Invoice Beanie documents.
    sse_queue     : If provided, SSE progress events are put here (one per txn).

    Returns
    -------
    dict with run summary: total, resolved, review, exceptions, precision/recall placeholders.
    """
    settings = get_settings()
    router   = LLMRouter(settings)
    fs_model = FSModel()   # Fellegi-Sunter model — shared across all txns in this batch

    # ── Load FS probability estimates from labeled data (if available) ─────────
    try:
        from app.models.ground_truth_label import GroundTruthLabel
        labels = await GroundTruthLabel.find(
            GroundTruthLabel.batch_id == batch_id
        ).to_list()
        if labels:
            # Build signal dicts for true and false pairs from ground truth
            # We approximate here: true_match labels → true_signals, rest → false
            # Full estimation requires running compare() on each labeled pair
            # (deferred to post-run analytics for simplicity)
            log.info(f"FS model: found {len(labels)} labels for batch {batch_id} (priors used for now)")
    except Exception as e:
        log.debug(f"FS label loading skipped: {e}")

    # ── Idempotency: purge previous run matches ─────────────────────────────
    await Match.find(
        Match.batch_id == batch_id,
        Match.run_id   == run_id,
    ).delete()

    # ── Build views ──────────────────────────────────────────────────────────
    txn_views = [_txn_to_view(t) for t in txn_docs]
    inv_views = [_invoice_to_view(i) for i in invoice_docs]
    inv_map   = {iv.invoice_id: iv for iv in inv_views}
    # ── Sort txns: larger amounts first for greedy assignment ─────────────────
    txn_views.sort(key=lambda t: t.amount, reverse=True)

    claimed_invoices: Set[str] = set()
    pending_matches  = []   # (match_doc, top_candidate, conf_result, llm_provider, llm_raw, txn_view)
    all_candidate_scores: Dict[Tuple[str, str], float] = {}

    total = len(txn_views)

    for idx, txn_view in enumerate(txn_views):
        log.info(f"[{idx+1}/{total}] Processing {txn_view.txn_id} ₹{txn_view.amount}")

        result = await _match_one_txn(
            txn_view, inv_views, inv_map, txn_views,
            batch_id, run_id, router, settings, claimed_invoices,
            fs_model=fs_model,
            candidate_scores_collector=all_candidate_scores,
        )

        # _match_one_txn returns either a plain Match (exception) or a tuple
        if isinstance(result, tuple):
            match, top, cr, llm_prov, llm_raw = result
        else:
            match = result
            top, cr, llm_prov, llm_raw = None, None, None, ""

        pending_matches.append((match, top, cr, llm_prov, llm_raw, txn_view))

        # Provisional claim (greedy — bipartite pass will validate)
        for li in match.line_items:
            if li.invoice_id:
                claimed_invoices.add(li.invoice_id)

        # SSE event
        if sse_queue:
            event = {
                "idx": idx + 1, "total": total,
                "txn_id": txn_view.txn_id,
                "amount": str(txn_view.amount),
                "band": match.confidence_band,
                "score": match.confidence_score,
                "match_type": match.match_type,
            }
            await sse_queue.put(_sse_event(event))

    # ── Hungarian Global Bipartite Optimization ──────────────────────────────
    pending_matches, hungarian_audits = apply_hungarian_to_batch(
        pending_matches=pending_matches,
        all_candidate_scores=all_candidate_scores,
        inv_map=inv_map,
    )

    # ── Persist matches + write audit logs ────────────────────────────────────
    auto_accept_count = review_count = reject_count = 0

    for match, top, cr, llm_prov, llm_raw, txn_view in pending_matches:
        await match.insert()

        if match.confidence_band == "auto_accept":
            auto_accept_count += 1
        elif match.confidence_band == "review":
            review_count += 1
        else:
            reject_count += 1

        # Audit: engine passes
        if top and cr:
            for contrib in top.contributions:
                if contrib.rule_fired:
                    await _write_audit(
                        match_id=match.match_id,
                        batch_id=batch_id,
                        pass_name=_contrib_to_pass(contrib.source),
                        score_delta=contrib.delta,
                        score_after=None,
                        reasoning=contrib.reason,
                    )

            # Audit: confidence scorer
            await _write_audit(
                match_id=match.match_id,
                batch_id=batch_id,
                pass_name="confidence_scorer",
                score_delta=None,
                score_after=cr.final_score,
                reasoning=f"Band={cr.band} Decision={cr.decision} Gates: "
                          f"human_review={cr.gate_human_review} "
                          f"hard_floor={cr.gate_hard_floor}",
            )

        # Audit: LLM pass
        if llm_prov and llm_prov not in ("none", ""):
            await _write_audit(
                match_id=match.match_id,
                batch_id=batch_id,
                pass_name="pass5_llm",
                score_delta=None,
                score_after=match.confidence_score,
                reasoning=match.explanation_text,
                raw_llm=llm_raw,
                llm_provider=llm_prov if llm_prov in ("gemini", "groq") else None,
                llm_model=settings.gemini_model if llm_prov == "gemini" else settings.groq_model,
                llm_fallback=(llm_prov == "groq"),
                llm_both_failed=(llm_prov == "fallback_no_llm"),
            )

    # Audit: Hungarian reassignments (if any occurred)
    for match_id, pass_name, reasoning in hungarian_audits:
        await _write_audit(
            match_id=match_id,
            batch_id=batch_id,
            pass_name=pass_name,
            score_delta=None,
            score_after=None,
            reasoning=reasoning,
        )

    # ── SSE: finalize ──────────────────────────────────────────────────────────
    if sse_queue:
        await sse_queue.put(_sse_event({
            "done": True,
            "auto_accept": auto_accept_count,
            "review": review_count,
            "exceptions": reject_count,
            "total": total,
        }))

    return {
        "batch_id":   batch_id,
        "run_id":     run_id,
        "total":      total,
        "auto_accept": auto_accept_count,
        "review":      review_count,
        "exceptions":  reject_count,
    }


def _contrib_to_pass(source: str) -> str:
    """Map a ScoreContribution source string to AuditLogEntry.pass_name literal."""
    if source.startswith("pass1"):
        return "pass1_rules"
    if source.startswith("pass2"):
        return "pass2_fuzzy"
    if source.startswith("pass3"):
        return "pass3_embedding"
    if source.startswith("pass4"):
        return "pass4_split_matcher"
    if source.startswith("pass5"):
        return "pass5_llm"
    return "confidence_scorer"
