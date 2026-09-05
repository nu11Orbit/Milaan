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
from typing import AsyncGenerator, Dict, List, Optional, Set, Tuple

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

_NOISE_THRESHOLD_RUPEES = Decimal("100")  # txns below ₹100 or bank interest → noise bucket

def _is_noise(txn: TxnView) -> bool:
    if txn.amount <= Decimal("10"):
        return True
    if "INTEREST" in (txn.narration or "").upper() and txn.amount < _NOISE_THRESHOLD_RUPEES:
        return True
    return False


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
    claimed_txns: Optional[Set[str]] = None,
    fs_model: Optional[FSModel] = None,
    candidate_scores_collector: Optional[Dict[Tuple[str, str], float]] = None,
) -> Optional[Match]:
    """
    Run the full 5-pass pipeline for one transaction.
    Returns a Match Beanie document (not yet inserted — caller inserts after
    bipartite assignment to avoid claiming invoices that get taken by higher-confidence matches).
    """
    if claimed_txns is None:
        claimed_txns = set()

    # ── Pre-pass: debit / refund ──────────────────────────────────────────────
    if txn_view.direction == "debit":
        match_id = f"MATCH-{uuid.uuid4().hex[:12]}"
        exp = f"Debit transaction with no corresponding open invoice to reverse against ({txn_view.narration})"
        return Match(
            match_id=match_id, batch_id=batch_id, run_id=run_id,
            match_type="exception", confidence_score=0.0, confidence_band="reject",
            line_items=[MatchLineItem(txn_id=txn_view.txn_id, allocated_amount=txn_view.amount)],
            explanation_text=exp[:280],
            explanation_source="rules_engine",
            exception_reason_category="debit_transaction",
            exception_reason_detail=f"Debit/Refund transaction ({txn_view.narration}) requires manual handling",
            threshold_snapshot={},
        )

    # ── Pre-pass: noise filter ─────────────────────────────────────────────────
    if _is_noise(txn_view):
        match_id = f"MATCH-{uuid.uuid4().hex[:12]}"
        exp = f"Noise transaction below threshold floor: amount ₹{txn_view.amount} ({txn_view.narration})"
        return Match(
            match_id=match_id, batch_id=batch_id, run_id=run_id,
            match_type="exception", confidence_score=0.0, confidence_band="reject",
            line_items=[MatchLineItem(txn_id=txn_view.txn_id, allocated_amount=txn_view.amount)],
            explanation_text=exp[:280],
            explanation_source="rules_engine",
            exception_reason_category="noise_below_floor",
            exception_reason_detail=f"Txn amount ₹{txn_view.amount} below noise threshold ₹{_NOISE_THRESHOLD_RUPEES}",
            threshold_snapshot={},
        )

    # ── Pre-pass: duplicate detection ─────────────────────────────────────────
    dup_of = detect_duplicate_txn(txn_view, all_txn_views)
    if dup_of:
        match_id = f"MATCH-{uuid.uuid4().hex[:12]}"
        exp = f"Duplicate transaction detected: likely duplicate of {dup_of} (same amount ₹{txn_view.amount} within 3 days)"
        return Match(
            match_id=match_id, batch_id=batch_id, run_id=run_id,
            match_type="exception", confidence_score=0.0, confidence_band="reject",
            line_items=[MatchLineItem(txn_id=txn_view.txn_id, allocated_amount=txn_view.amount)],
            explanation_text=exp[:280],
            explanation_source="rules_engine",
            exception_reason_category="duplicate_detected",
            exception_reason_detail=f"Likely duplicate of {dup_of} — same amount, narration, within 3 days",
            threshold_snapshot={},
        )

    # ── Narrow candidates ──────────────────────────────────────────────────────
    narrow = candidate_filter.narrow_candidates(txn_view, inv_views, settings)
    # Exclude already claimed invoices
    narrow = [iv for iv in narrow if iv.invoice_id not in claimed_invoices]

    if not narrow:
        match_id = f"MATCH-{uuid.uuid4().hex[:12]}"
        exp = f"No invoice candidate found within date/amount window for this counterparty ({txn_view.narration})"
        return Match(
            match_id=match_id, batch_id=batch_id, run_id=run_id,
            match_type="exception", confidence_score=0.0, confidence_band="reject",
            line_items=[MatchLineItem(txn_id=txn_view.txn_id, allocated_amount=txn_view.amount)],
            explanation_text=exp[:280],
            explanation_source="rules_engine",
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

    # ── Pass 4 (split/batch) if still unresolved by Pass 1 exact match ────────
    split_result: Optional[SplitMatchResult] = None
    if top is None or top.resolved_by is None or top.resolved_by in ("pass2_fuzzy", "pass3_embedding"):
        # 1. Try batch payout: this txn → many invoices (e.g. TXN-007 ₹120k → INV-006 + INV-007)
        batch_result = run_pass4_batch(txn_view, narrow, settings)
        if batch_result.match_type == "batch_one_to_many":
            split_result = batch_result

        # 2. Try split settlement: many txns → one candidate invoice (e.g. TXN-004 + TXN-005 → INV-004)
        if split_result is None:
            split_pool = [t for t in all_txn_views if t.txn_id not in claimed_txns and t.direction == "credit"]
            partial_candidate = None
            for cand_inv in narrow:
                sr = run_pass4_split(inv_map.get(cand_inv.invoice_id), split_pool, settings)
                if sr.match_type == "split_many_to_one" and txn_view.txn_id in sr.txn_ids:
                    split_result = sr
                    break
                elif sr.match_type == "partial" and partial_candidate is None and txn_view.txn_id in sr.txn_ids:
                    partial_candidate = sr
                elif sr.match_type == "flagged_for_llm" and partial_candidate is None:
                    partial_candidate = sr

            if split_result is None and partial_candidate is not None:
                split_result = partial_candidate
            elif split_result is None and batch_result.match_type == "flagged_for_llm":
                split_result = batch_result

    if split_result and split_result.match_type in ("split_many_to_one", "batch_one_to_many", "partial"):
        if top is None:
            primary_inv = split_result.invoice_ids[0] if split_result.invoice_ids else ""
            top = CandidateMatch(invoice_id=primary_inv, txn_id=txn_view.txn_id)
        elif split_result.invoice_ids and top.invoice_id not in split_result.invoice_ids:
            top.invoice_id = split_result.invoice_ids[0]

        top.add("pass4_split_matcher", split_result.confidence_delta, split_result.explanation)
        top.resolved_by = "pass4_split_matcher"
        top.match_type = split_result.match_type

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
        exp = f"No viable invoice candidate found within date/amount window for {txn_view.txn_id} ({txn_view.narration})"
        return Match(
            match_id=match_id, batch_id=batch_id, run_id=run_id,
            match_type="exception", confidence_score=0.0, confidence_band="reject",
            line_items=[MatchLineItem(txn_id=txn_view.txn_id, allocated_amount=txn_view.amount)],
            explanation_text=exp[:280],
            explanation_source="rules_engine",
            exception_reason_category="no_candidate_found",
            exception_reason_detail="All passes exhausted — no match candidate found",
            threshold_snapshot={},
        )

    # ── Pass 5 (LLM) ──────────────────────────────────────────────────────────
    llm_response, llm_provider, llm_raw, both_rate_limited = None, "none", "", False
    if settings.enable_llm and should_run_pass5(top, req_review, flagged, settings):
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
        if mtype == "batch_one_to_many":
            line_items = [
                MatchLineItem(
                    txn_id=txn_view.txn_id,
                    invoice_id=iid,
                    allocated_amount=split_result.allocated_amounts.get(iid, Decimal("0")),
                )
                for iid in split_result.invoice_ids
            ]
        elif mtype == "split_many_to_one":
            target_inv = split_result.invoice_ids[0] if split_result.invoice_ids else top.invoice_id
            line_items = [
                MatchLineItem(
                    txn_id=tid,
                    invoice_id=target_inv,
                    allocated_amount=split_result.allocated_amounts.get(tid, Decimal("0")),
                )
                for tid in split_result.txn_ids
            ]
        else:
            line_items = [
                MatchLineItem(
                    txn_id=txn_view.txn_id,
                    invoice_id=top.invoice_id,
                    allocated_amount=split_result.allocated_amounts.get(txn_view.txn_id, txn_view.amount),
                )
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

    if not explanation:
        if mtype == "exception":
            explanation = f"No viable invoice candidate found for {txn_view.txn_id} (score {cr.final_score:.1f})."
        else:
            explanation = f"Match decision for {txn_view.txn_id} with score {cr.final_score:.1f} ({cr.decision})."

    _SOURCE_MAP = {
        "pass1": "rules_engine",
        "pass2": "fuzzy",
        "pass3": "embedding",
        "pass4": "embedding",   # split/batch matcher — closest semantic bucket
        "pass5": "llm",
    }
    if llm_provider in ("gemini", "groq"):
        exp_source = "llm"
    elif top and top.resolved_by:
        prefix = next((k for k in _SOURCE_MAP if top.resolved_by.startswith(k)), None)
        exp_source = _SOURCE_MAP[prefix] if prefix else "none"
    else:
        exp_source = "none"

    exc_cat = top.exception_reason_category if (top and top.is_exception) else None
    if cr.decision == "reject" and not exc_cat:
        exc_cat = "low_confidence_match"

    match = Match(
        match_id=match_id, batch_id=batch_id, run_id=run_id,
        match_type=mtype,
        confidence_score=cr.final_score,
        confidence_band=cr.decision,
        explanation_text=explanation[:280],
        explanation_source=exp_source,
        line_items=line_items,
        threshold_snapshot=cr.threshold_snapshot,
        exception_reason_category=exc_cat,
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

    # ── Load FS probability estimates from labeled data (if available) ────────
    try:
        from app.models.ground_truth_label import GroundTruthLabel
        labels = await GroundTruthLabel.find(
            GroundTruthLabel.batch_id == batch_id
        ).to_list()
        if labels:
            log.info(f"FS model: found {len(labels)} labels for batch {batch_id} (priors used for now)")
    except Exception as e:
        log.debug(f"FS label loading skipped: {e}")

    # ── Idempotency: purge previous run matches ───────────────────────────────
    await Match.find(
        Match.batch_id == batch_id,
        Match.run_id   == run_id,
    ).delete()

    # ── Build views ──────────────────────────────────────────────────
    txn_views = [_txn_to_view(t) for t in txn_docs]
    inv_views = [_invoice_to_view(i) for i in invoice_docs]
    inv_map   = {iv.invoice_id: iv for iv in inv_views}
    # ── Sort txns: larger amounts first for greedy assignment ────────────────────
    txn_views.sort(key=lambda t: (-t.amount, t.txn_date, t.txn_id))

    claimed_txns: Set[str] = set()
    claimed_invoices: Set[str] = set()
    pending_matches  = []   # (match_doc, top_candidate, conf_result, llm_provider, llm_raw, txn_view)
    all_candidate_scores: Dict[Tuple[str, str], float] = {}

    total_txns = len(txn_views)
    # Estimated total for SSE progress (refined after Hungarian)
    estimated_total = total_txns

    for idx, txn_view in enumerate(txn_views):
        if txn_view.txn_id in claimed_txns:
            log.info(f"Skipping {txn_view.txn_id} — already resolved in multi-transaction split match")
            continue

        log.info(f"[{idx+1}/{total_txns}] Processing {txn_view.txn_id} ₹{txn_view.amount}")

        result = await _match_one_txn(
            txn_view, inv_views, inv_map, txn_views,
            batch_id, run_id, router, settings, claimed_invoices,
            claimed_txns=claimed_txns,
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

        # Multi-record matches (split/batch) claim their participating txns and invoices immediately
        if match.match_type in ("split_many_to_one", "batch_one_to_many"):
            for li in match.line_items:
                claimed_txns.add(li.txn_id)
                if li.invoice_id:
                    claimed_invoices.add(li.invoice_id)

        # ── Emit live SSE event immediately after each txn is resolved ───────────
        # This makes the frontend stream records live instead of waiting for
        # the entire batch + Hungarian to complete.
        if sse_queue:
            txns_in_match = sorted(list(set(li.txn_id for li in match.line_items if li.txn_id)))
            txn_display = " + ".join(txns_in_match) if len(txns_in_match) > 1 else txn_view.txn_id
            amount_display = (
                str(sum(li.allocated_amount for li in match.line_items if li.allocated_amount))
                if len(txns_in_match) > 1
                else str(txn_view.amount)
            )
            invs_in_match: list[str] = []
            for li in match.line_items:
                if li.invoice_id and li.invoice_id not in invs_in_match:
                    invs_in_match.append(li.invoice_id)

            # Use current length as preliminary index; total is an estimate
            event = {
                "idx": len(pending_matches),
                "total": estimated_total,   # refined after Hungarian
                "match_id": match.match_id,
                "txn_id": txn_display,
                "amount": amount_display,
                "band": match.confidence_band,
                "score": match.confidence_score,
                "match_type": match.match_type,
                "invoices": invs_in_match,
                "explanation": match.explanation_text or "",
            }
            await sse_queue.put(_sse_event(event))

    # ── Hungarian Global Bipartite Optimization ──────────────────────────────
    pending_matches, hungarian_audits = apply_hungarian_to_batch(
        pending_matches=pending_matches,
        all_candidate_scores=all_candidate_scores,
        inv_map=inv_map,
    )

    total_matches = len(pending_matches)

    # ── Persist matches + write audit logs ───────────────────────────────────
    auto_accept_count = review_count = reject_count = 0

    for m_idx, (match, top, cr, llm_prov, llm_raw, txn_view) in enumerate(pending_matches):
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

    # ── SSE: finalize ───────────────────────────────────────────────────────
    if sse_queue:
        await sse_queue.put(_sse_event({
            "done": True,
            "auto_accept": auto_accept_count,
            "review": review_count,
            "exceptions": reject_count,
            "total": total_matches,
        }))

    return {
        "batch_id":   batch_id,
        "run_id":     run_id,
        "total":      total_matches,
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
