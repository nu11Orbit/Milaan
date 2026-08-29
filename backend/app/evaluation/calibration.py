"""
evaluation/calibration.py
Confidence Score Calibration & Reliability Analysis
====================================================

Transforms raw heuristic/LLM scores into calibrated probabilities using
Isotonic Regression (non-parametric monotonic regression) and computes
calibration diagnostics (Brier Score, Expected Calibration Error).

Theory
------
A prediction score P ∈ [0, 100] is *well-calibrated* if, among all predictions
with confidence ≈ P, approximately a fraction P / 100 are true positives.
For example, among predictions given score 80%, exactly 80% should be correct.

Raw confidence scores often suffer from over-confidence or under-confidence.
Isotonic regression fits a piecewise-constant, non-decreasing function:
    min Σ (y_i - f(s_i))²  subject to  f(s_i) ≤ f(s_j) whenever s_i ≤ s_j

Metrics
-------
• Brier Score: Mean squared difference between predicted probability and binary outcome.
  Range [0, 1]. Lower is better. 0.0 is perfect calibration and discrimination.
• Expected Calibration Error (ECE): Weighted average difference between accuracy
  and confidence across binned intervals. Lower is better.
• Calibration Curve (Reliability Diagram): Empirical true-positive rate vs.
  mean predicted confidence per bin.

References
----------
• Niculescu-Mizil & Caruana, "Predicting Good Probabilities With Supervised Learning", ICML 2005
• Guo et al., "On Calibration of Modern Neural Networks", ICML 2017
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

import numpy as np
from sklearn.isotonic import IsotonicRegression

from app.models.ground_truth_label import GroundTruthLabel
from app.models.match import Match

log = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# Pure Statistical Metrics (No DB dependencies)
# ─────────────────────────────────────────────────────────────────────────────

def compute_brier_score(y_true: List[int], y_prob: List[float]) -> float:
    """
    Compute Brier Score: (1/N) * Σ (p_i - y_i)².

    Parameters
    ----------
    y_true : Ground truth binary indicators (0 or 1)
    y_prob : Predicted probabilities in [0.0, 1.0]

    Returns
    -------
    float in [0.0, 1.0]. Lower is better.
    """
    if not y_true or not y_prob or len(y_true) != len(y_prob):
        return 0.0
    y_t = np.array(y_true, dtype=np.float64)
    y_p = np.array(y_prob, dtype=np.float64)
    return float(np.mean((y_p - y_t) ** 2))


def compute_ece(
    y_true: List[int],
    y_prob: List[float],
    n_bins: int = 5,
) -> float:
    """
    Compute Expected Calibration Error (ECE) across equal-width bins.

    ECE = Σ (|B_m| / N) * |acc(B_m) - conf(B_m)|

    Parameters
    ----------
    y_true : Ground truth binary indicators (0 or 1)
    y_prob : Predicted probabilities in [0.0, 1.0]
    n_bins : Number of confidence bins (default: 5, e.g. 0-0.2, 0.2-0.4, etc.)

    Returns
    -------
    float in [0.0, 1.0]. Lower is better.
    """
    if not y_true or not y_prob or len(y_true) != len(y_prob):
        return 0.0

    y_t = np.array(y_true, dtype=np.float64)
    y_p = np.array(y_prob, dtype=np.float64)
    N = len(y_t)

    bin_edges = np.linspace(0.0, 1.0, n_bins + 1)
    ece = 0.0

    for i in range(n_bins):
        low, high = bin_edges[i], bin_edges[i + 1]
        # Include right edge on the last bin
        if i == n_bins - 1:
            mask = (y_p >= low) & (y_p <= high)
        else:
            mask = (y_p >= low) & (y_p < high)

        bin_size = np.sum(mask)
        if bin_size > 0:
            bin_acc = np.mean(y_t[mask])
            bin_conf = np.mean(y_p[mask])
            ece += (bin_size / N) * abs(bin_acc - bin_conf)

    return float(round(ece, 4))


def compute_calibration_curve(
    y_true: List[int],
    y_prob: List[float],
    n_bins: int = 5,
) -> List[Dict]:
    """
    Compute reliability diagram points for charting.

    Returns a list of bin dictionaries:
      - bin_label: string range (e.g. "60% - 80%")
      - mean_confidence: average predicted probability in this bin
      - empirical_accuracy: actual fraction of true positives in this bin
      - sample_count: number of records falling in this bin
      - ideal: perfectly calibrated reference value (= mean_confidence)
    """
    if not y_true or not y_prob or len(y_true) != len(y_prob):
        return []

    y_t = np.array(y_true, dtype=np.float64)
    y_p = np.array(y_prob, dtype=np.float64)

    bin_edges = np.linspace(0.0, 1.0, n_bins + 1)
    curve = []

    for i in range(n_bins):
        low, high = bin_edges[i], bin_edges[i + 1]
        if i == n_bins - 1:
            mask = (y_p >= low) & (y_p <= high)
        else:
            mask = (y_p >= low) & (y_p < high)

        count = int(np.sum(mask))
        if count > 0:
            acc = float(np.mean(y_t[mask]))
            conf = float(np.mean(y_p[mask]))
        else:
            acc = 0.0
            conf = float((low + high) / 2.0)

        curve.append({
            "bin_index": i,
            "bin_label": f"{int(low * 100)}%-{int(high * 100)}%",
            "mean_confidence": round(conf * 100, 1),
            "empirical_accuracy": round(acc * 100, 1),
            "sample_count": count,
            "ideal": round(conf * 100, 1),
        })

    return curve


def fit_isotonic_calibrator(
    raw_scores: List[float],
    y_true: List[int],
) -> Tuple[IsotonicRegression, List[float]]:
    """
    Fit an Isotonic Regression model mapping raw scores [0, 100] to calibrated probabilities [0, 1].

    Parameters
    ----------
    raw_scores : List of raw confidence scores in [0.0, 100.0]
    y_true     : Ground truth binary labels (1 for correct match, 0 for false match)

    Returns
    -------
    (calibrator, calibrated_probabilities)
    """
    X = np.array(raw_scores, dtype=np.float64) / 100.0   # Scale to [0, 1]
    y = np.array(y_true, dtype=np.float64)

    iso = IsotonicRegression(y_min=0.0, y_max=1.0, out_of_bounds="clip")
    iso.fit(X, y)
    calibrated_probs = iso.predict(X).tolist()

    return iso, calibrated_probs


# ─────────────────────────────────────────────────────────────────────────────
# Database-Aware Batch Calibration
# ─────────────────────────────────────────────────────────────────────────────

async def calibrate_batch(batch_id: str, run_id: Optional[str] = None) -> Dict:
    """
    Evaluate and calibrate confidence scores for a batch against GroundTruthLabel records.

    Returns calibration metrics, reliability curve, and Brier score before and after calibration.
    """
    # 1. Fetch matches and ground truth labels
    query_args = [Match.batch_id == batch_id]
    if run_id:
        query_args.append(Match.run_id == run_id)
    matches = await Match.find(*query_args).to_list()

    gt_labels = await GroundTruthLabel.find(GroundTruthLabel.batch_id == batch_id).to_list()

    if not matches:
        return {
            "batch_id": batch_id,
            "error": "No matches found for this batch",
            "is_calibrated": False,
        }

    if not gt_labels:
        return {
            "batch_id": batch_id,
            "error": "No ground truth labels available for calibration. Upload ground truth first.",
            "is_calibrated": False,
        }

    gt_by_invoice = {gt.invoice_id: gt for gt in gt_labels}

    raw_scores: List[float] = []
    y_true: List[int] = []

    from app.evaluation.metrics import evaluate_match

    for match in matches:
        pred_txn_ids = frozenset(li.txn_id for li in match.line_items if li.txn_id)
        pred_invoice_ids = frozenset(li.invoice_id for li in match.line_items if li.invoice_id)

        # Evaluate if match matches ground truth
        is_tp = 0
        for inv_id in pred_invoice_ids:
            gt = gt_by_invoice.get(inv_id)
            if gt is not None:
                gt_txns = frozenset(gt.txn_ids)
                gt_invs = frozenset([gt.invoice_id])
                if evaluate_match(pred_txn_ids, pred_invoice_ids, gt_txns, gt_invs):
                    is_tp = 1
                    break

        raw_scores.append(match.confidence_score)
        y_true.append(is_tp)

    raw_probs = [s / 100.0 for s in raw_scores]

    # Diagnostics before calibration
    raw_brier = compute_brier_score(y_true, raw_probs)
    raw_ece = compute_ece(y_true, raw_probs, n_bins=5)
    raw_curve = compute_calibration_curve(y_true, raw_probs, n_bins=5)

    # Fit isotonic regression
    if len(set(y_true)) > 1:
        iso_model, cal_probs = fit_isotonic_calibrator(raw_scores, y_true)
        cal_brier = compute_brier_score(y_true, cal_probs)
        cal_ece = compute_ece(y_true, cal_probs, n_bins=5)
        cal_curve = compute_calibration_curve(y_true, cal_probs, n_bins=5)
        calibrated = True
    else:
        cal_brier = raw_brier
        cal_ece = raw_ece
        cal_curve = raw_curve
        calibrated = False

    return {
        "batch_id": batch_id,
        "run_id": run_id,
        "sample_size": len(raw_scores),
        "is_calibrated": calibrated,
        "raw_metrics": {
            "brier_score": round(raw_brier, 4),
            "expected_calibration_error": round(raw_ece, 4),
        },
        "calibrated_metrics": {
            "brier_score": round(cal_brier, 4),
            "expected_calibration_error": round(cal_ece, 4),
        },
        "brier_improvement_pct": round(((raw_brier - cal_brier) / raw_brier * 100), 1) if raw_brier > 0 else 0.0,
        "calibration_curve": raw_curve,
        "calibrated_curve": cal_curve,
        "interpretation": (
            "Calibration curve maps predicted confidence vs actual true-positive rate. "
            "A Brier score closer to 0 indicates superior probability calibration."
        ),
    }
