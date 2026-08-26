"""
evaluation/metrics.py
Precision / Recall / F1 — Reconciliation Event Level
=======================================================

Key design: matching accuracy is measured at the RECONCILIATION EVENT level,
not naive pairwise (txn_id, invoice_id) level. This matters because:

  A split settlement (3 txns → 1 invoice) is ONE reconciliation event.
  Naive pairwise would count it as 3 separate predictions.
  Set-level correctness counts it as 1: correct if and only if
  the predicted group exactly matches the ground-truth group.

Metrics computed:
  precision    = TP / (TP + FP)   on auto_accept band only
  recall       = TP / (TP + FN)   across all bands (auto + review)
  F1           = harmonic mean of precision and recall
  fp_rupee_cost = Σ allocated_amount of auto-accept false positives
  exception_completeness = 100% of reject-band records have non-null reason

All metrics are also broken down by case_category
(Cases 1–15 from build plan Section 5.4) so the report shows
"78% precision on split settlements" not just a blended number.

Usage:
    result = await compute_metrics(batch_id, run_id)
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Dict, List, Optional, Set, Tuple

from app.models.match import Match
from app.models.ground_truth_label import GroundTruthLabel

log = logging.getLogger(__name__)


# ── Set-level correctness ─────────────────────────────────────────────────────

def evaluate_match(
    predicted_txn_ids:     Set[str],
    predicted_invoice_ids: Set[str],
    gt_txn_ids:            Set[str],
    gt_invoice_ids:        Set[str],
) -> bool:
    """
    Return True iff the predicted reconciliation group EXACTLY matches
    the ground-truth group.

    For 1:1 matches both sets have exactly one element.
    For split_many_to_one: predicted_txn_ids must equal gt_txn_ids,
    and both invoice sets must be identical singletons.
    For batch_one_to_many: predicted_invoice_ids must equal gt_invoice_ids.

    Partial matches (subset of the correct group) are counted as FALSE.
    This is strict but correct — a partial split match would leave an
    open balance that the system failed to capture.
    """
    return (
        predicted_txn_ids     == gt_txn_ids and
        predicted_invoice_ids == gt_invoice_ids
    )


# ── Result dataclass ──────────────────────────────────────────────────────────

@dataclass
class MetricsResult:
    batch_id: str
    run_id:   Optional[str]

    total_predictions:     int = 0    # all matches in the batch
    total_ground_truths:   int = 0    # all true matches in ground truth
    auto_accept_count:     int = 0
    review_count:          int = 0
    reject_count:          int = 0

    # Core metrics
    true_positives:  int = 0    # auto_accept correct matches
    false_positives: int = 0    # auto_accept incorrect matches (DANGEROUS)
    false_negatives: int = 0    # true matches not in auto_accept band
    true_negatives:  int = 0    # correct exceptions / correct non-matches

    precision: float = 0.0
    recall:    float = 0.0
    f1:        float = 0.0

    # False-positive rupee cost — sum of allocated amounts in wrong auto-accepts
    fp_rupee_cost: Decimal = Decimal("0")

    # Exception completeness (must be 100%)
    exceptions_with_reason:    int = 0
    exceptions_without_reason: int = 0
    exception_completeness_pct: float = 0.0

    # Per case-category breakdown
    by_category: Dict[str, Dict] = field(default_factory=dict)

    # Warnings
    warnings: List[str] = field(default_factory=list)


# ── Main computation ──────────────────────────────────────────────────────────

async def compute_metrics(
    batch_id: str,
    run_id:   Optional[str] = None,
) -> MetricsResult:
    """
    Compute precision/recall/F1 for a batch run against ground-truth labels.

    Ground truth must exist in the GroundTruthLabel collection (written by the
    synthetic data generator). If no ground truth exists, only throughput
    and exception-completeness metrics are returned.
    """
    result = MetricsResult(batch_id=batch_id, run_id=run_id)

    # ── Load matches ──────────────────────────────────────────────────────────
    match_query = [Match.batch_id == batch_id]
    if run_id:
        match_query.append(Match.run_id == run_id)
    matches = await Match.find(*match_query).to_list()

    result.total_predictions = len(matches)
    result.auto_accept_count = sum(1 for m in matches if m.confidence_band == "auto_accept")
    result.review_count      = sum(1 for m in matches if m.confidence_band == "review")
    result.reject_count      = sum(1 for m in matches if m.confidence_band == "reject")

    # ── Exception completeness ────────────────────────────────────────────────
    rejects = [m for m in matches if m.confidence_band == "reject"]
    result.exceptions_with_reason    = sum(1 for m in rejects if m.exception_reason_category)
    result.exceptions_without_reason = sum(1 for m in rejects if not m.exception_reason_category)
    if rejects:
        result.exception_completeness_pct = round(
            result.exceptions_with_reason / len(rejects) * 100, 1
        )
        if result.exceptions_without_reason > 0:
            result.warnings.append(
                f"VIOLATION: {result.exceptions_without_reason} reject-band records "
                f"have no exception_reason_category. Target is 100%."
            )
    else:
        result.exception_completeness_pct = 100.0

    # ── Load ground truth ─────────────────────────────────────────────────────
    gt_labels = await GroundTruthLabel.find(
        GroundTruthLabel.batch_id == batch_id
    ).to_list() if hasattr(GroundTruthLabel, "batch_id") else \
        await GroundTruthLabel.find_all().to_list()

    if not gt_labels:
        result.warnings.append(
            "No GroundTruthLabel records found for this batch — "
            "precision/recall cannot be computed. "
            "Run the synthetic data generator to populate ground truth."
        )
        return result

    # Build ground-truth lookup: {frozenset(txn_ids) | frozenset(invoice_ids)} → label
    gt_true = [lb for lb in gt_labels if lb.is_true_match]
    result.total_ground_truths = len(gt_true)

    # Index GT by invoice_id for fast lookup
    gt_by_invoice: Dict[str, GroundTruthLabel] = {
        lb.invoice_id: lb for lb in gt_true
    }
    # Track which GT labels were matched (for FN computation)
    matched_gt: Set[str] = set()

    # ── Score each auto_accept prediction against GT ──────────────────────────
    auto_accepts = [m for m in matches if m.confidence_band == "auto_accept"]

    for match in auto_accepts:
        # Extract predicted groups from line items
        pred_txn_ids     = frozenset(li.txn_id     for li in match.line_items if li.txn_id)
        pred_invoice_ids = frozenset(li.invoice_id for li in match.line_items if li.invoice_id)

        is_tp = False
        for inv_id in pred_invoice_ids:
            gt = gt_by_invoice.get(inv_id)
            if gt is None:
                continue
            gt_txn_ids_set     = frozenset(gt.txn_ids)
            gt_invoice_ids_set = frozenset([gt.invoice_id])

            if evaluate_match(pred_txn_ids, pred_invoice_ids, gt_txn_ids_set, gt_invoice_ids_set):
                is_tp = True
                matched_gt.add(inv_id)

                # Per-category tracking
                cat = gt.case_category or "unknown"
                _add_to_category(result.by_category, cat, tp=1)
                break

        if is_tp:
            result.true_positives += 1
        else:
            result.false_positives += 1
            # Compute FP rupee cost
            fp_amt = sum(li.allocated_amount for li in match.line_items if li.allocated_amount)
            result.fp_rupee_cost += fp_amt

            # Per-category FP
            for inv_id in pred_invoice_ids:
                gt = gt_by_invoice.get(inv_id)
                cat = gt.case_category if gt else "unknown"
                _add_to_category(result.by_category, cat, fp=1)

    # ── Also check review-band for recall (true matches in review = FN for auto) ─
    review_matches = [m for m in matches if m.confidence_band == "review"]
    for match in review_matches:
        pred_txn_ids     = frozenset(li.txn_id     for li in match.line_items if li.txn_id)
        pred_invoice_ids = frozenset(li.invoice_id for li in match.line_items if li.invoice_id)

        for inv_id in pred_invoice_ids:
            gt = gt_by_invoice.get(inv_id)
            if gt is None:
                continue
            gt_txn_ids_set     = frozenset(gt.txn_ids)
            gt_invoice_ids_set = frozenset([gt.invoice_id])
            if evaluate_match(pred_txn_ids, pred_invoice_ids, gt_txn_ids_set, gt_invoice_ids_set):
                matched_gt.add(inv_id)
                cat = gt.case_category or "unknown"
                _add_to_category(result.by_category, cat, review_tp=1)

    # ── False negatives: GT matches not found at all ──────────────────────────
    unmatched_gt = set(gt_by_invoice.keys()) - matched_gt
    result.false_negatives = len(unmatched_gt)
    for inv_id in unmatched_gt:
        cat = gt_by_invoice[inv_id].case_category or "unknown"
        _add_to_category(result.by_category, cat, fn=1)

    # ── Compute overall metrics ───────────────────────────────────────────────
    tp = result.true_positives
    fp = result.false_positives
    fn = result.false_negatives

    result.precision = round(tp / (tp + fp), 4) if (tp + fp) > 0 else 0.0
    result.recall    = round(tp / (tp + fn), 4) if (tp + fn) > 0 else 0.0
    if result.precision + result.recall > 0:
        result.f1 = round(
            2 * result.precision * result.recall / (result.precision + result.recall), 4
        )

    # ── Per-category precision/recall ─────────────────────────────────────────
    for cat, counts in result.by_category.items():
        tp_c  = counts.get("tp", 0)
        fp_c  = counts.get("fp", 0)
        fn_c  = counts.get("fn", 0)
        counts["precision"] = round(tp_c / (tp_c + fp_c), 3) if (tp_c + fp_c) > 0 else None
        counts["recall"]    = round(tp_c / (tp_c + fn_c), 3) if (tp_c + fn_c) > 0 else None

    # ── Success criteria check ────────────────────────────────────────────────
    if result.precision < 0.95:
        result.warnings.append(
            f"Precision {result.precision:.1%} is below the 95% target for auto-accept."
        )
    if result.recall < 0.90:
        result.warnings.append(
            f"Recall {result.recall:.1%} is below the 90% target."
        )

    return result


def _add_to_category(
    by_category: Dict,
    cat: str,
    tp: int = 0,
    fp: int = 0,
    fn: int = 0,
    review_tp: int = 0,
) -> None:
    if cat not in by_category:
        by_category[cat] = {"tp": 0, "fp": 0, "fn": 0, "review_tp": 0}
    by_category[cat]["tp"]        += tp
    by_category[cat]["fp"]        += fp
    by_category[cat]["fn"]        += fn
    by_category[cat]["review_tp"] += review_tp


# ── Serialisable output for the API ──────────────────────────────────────────

def metrics_to_dict(r: MetricsResult) -> dict:
    return {
        "batch_id":  r.batch_id,
        "run_id":    r.run_id,
        "totals": {
            "predictions":    r.total_predictions,
            "ground_truths":  r.total_ground_truths,
            "auto_accept":    r.auto_accept_count,
            "review":         r.review_count,
            "reject":         r.reject_count,
        },
        "accuracy": {
            "true_positives":  r.true_positives,
            "false_positives": r.false_positives,
            "false_negatives": r.false_negatives,
            "precision":       r.precision,
            "recall":          r.recall,
            "f1":              r.f1,
            "fp_rupee_cost":   str(r.fp_rupee_cost),
        },
        "exception_completeness": {
            "with_reason":    r.exceptions_with_reason,
            "without_reason": r.exceptions_without_reason,
            "completeness_pct": r.exception_completeness_pct,
        },
        "by_case_category": r.by_category,
        "success_criteria": {
            "precision_target": "≥ 95%",
            "precision_met":    r.precision >= 0.95,
            "recall_target":    "≥ 90%",
            "recall_met":       r.recall >= 0.90,
            "exception_completeness_target": "100%",
            "exception_completeness_met": r.exceptions_without_reason == 0,
        },
        "warnings": r.warnings,
    }
