"""
tests/test_calibration.py
Unit tests for Confidence Score Calibration & Reliability Metrics (Isotonic Regression, Brier Score, ECE).
"""

from __future__ import annotations

import pytest
from app.evaluation.calibration import (
    compute_brier_score,
    compute_calibration_curve,
    compute_ece,
    fit_isotonic_calibrator,
)


class TestBrierScore:

    def test_perfect_predictions_give_zero_brier(self):
        """When predictions match true binary outcomes exactly, Brier score is 0.0."""
        y_true = [1, 0, 1, 1, 0]
        y_prob = [1.0, 0.0, 1.0, 1.0, 0.0]
        assert compute_brier_score(y_true, y_prob) == 0.0

    def test_worst_predictions_give_one_brier(self):
        """When predictions are 100% wrong, Brier score is 1.0."""
        y_true = [1, 1, 0, 0]
        y_prob = [0.0, 0.0, 1.0, 1.0]
        assert compute_brier_score(y_true, y_prob) == 1.0

    def test_neutral_predictions_give_quarter_brier(self):
        """Constant 0.5 prediction gives Brier score of 0.25 on balanced binary data."""
        y_true = [1, 0, 1, 0]
        y_prob = [0.5, 0.5, 0.5, 0.5]
        assert compute_brier_score(y_true, y_prob) == 0.25

    def test_empty_or_mismatched_inputs(self):
        """Empty or mismatched inputs return 0.0 without error."""
        assert compute_brier_score([], []) == 0.0
        assert compute_brier_score([1], [0.5, 0.5]) == 0.0


class TestECE:

    def test_perfect_calibration_gives_zero_ece(self):
        """When mean confidence in each bin equals empirical accuracy, ECE is 0.0."""
        # 10 records with 80% confidence, exactly 8 of them are true positives
        y_true = [1] * 8 + [0] * 2
        y_prob = [0.8] * 10
        assert compute_ece(y_true, y_prob, n_bins=5) == pytest.approx(0.0, abs=1e-3)

    def test_overconfident_predictions_give_high_ece(self):
        """When records with 95% confidence are only 50% accurate, ECE reflects the gap."""
        y_true = [1] * 5 + [0] * 5
        y_prob = [0.95] * 10
        # Expected gap = |0.50 - 0.95| = 0.45
        assert compute_ece(y_true, y_prob, n_bins=5) == pytest.approx(0.45, abs=1e-2)


class TestCalibrationCurve:

    def test_curve_structure_and_bins(self):
        """Calibration curve returns correct bin metadata and 5 default bins."""
        y_true = [1, 0, 1, 1, 0, 1, 0, 1, 1, 1]
        y_prob = [0.1, 0.15, 0.35, 0.55, 0.7, 0.75, 0.85, 0.9, 0.92, 0.95]
        curve = compute_calibration_curve(y_true, y_prob, n_bins=5)

        assert len(curve) == 5
        for pt in curve:
            assert "bin_index" in pt
            assert "bin_label" in pt
            assert "mean_confidence" in pt
            assert "empirical_accuracy" in pt
            assert "sample_count" in pt
            assert "ideal" in pt

        # Total sample count across bins must equal input length
        total_samples = sum(pt["sample_count"] for pt in curve)
        assert total_samples == len(y_true)


class TestIsotonicRegression:

    def test_isotonic_calibrator_monotonicity(self):
        """Isotonic regression guarantees non-decreasing calibrated probabilities."""
        raw_scores = [35.0, 50.0, 65.0, 75.0, 85.0, 92.0, 98.0]
        y_true = [0, 0, 1, 0, 1, 1, 1]

        model, cal_probs = fit_isotonic_calibrator(raw_scores, y_true)

        # Check non-decreasing condition
        for i in range(len(cal_probs) - 1):
            assert cal_probs[i] <= cal_probs[i + 1] + 1e-9, (
                f"Monotonicity violation at index {i}: {cal_probs[i]} > {cal_probs[i+1]}"
            )

    def test_isotonic_improves_brier_on_overconfident_data(self):
        """Isotonic calibration reduces Brier score on overconfident predictions."""
        # Uncalibrated: model claims 95% confidence on everything, but true accuracy is only 60%
        raw_scores = [95.0] * 10
        y_true = [1] * 6 + [0] * 4

        raw_probs = [s / 100.0 for s in raw_scores]
        raw_brier = compute_brier_score(y_true, raw_probs)

        # Diverse scores with systematic overconfidence
        raw_scores_diverse = [60.0, 70.0, 80.0, 90.0, 95.0, 98.0, 99.0, 99.0]
        y_true_diverse =     [0,    0,    1,    0,    1,    1,    1,    1]
        raw_brier_div = compute_brier_score(y_true_diverse, [s / 100.0 for s in raw_scores_diverse])

        model, cal_probs = fit_isotonic_calibrator(raw_scores_diverse, y_true_diverse)
        cal_brier = compute_brier_score(y_true_diverse, cal_probs)

        assert cal_brier <= raw_brier_div + 1e-6, f"Calibrated Brier ({cal_brier}) should be <= raw ({raw_brier_div})"
