"""
tests/test_benfords_law.py
Unit tests for Benford's Law forensic analysis and Antibenford counterparty detection.
"""

from __future__ import annotations

from decimal import Decimal
import numpy as np
import pytest

from app.engine.benfords_law import (
    BENFORD_THEORETICAL,
    benford_chi_square_test,
    compute_benford_distribution,
    detect_antibenford_counterparties,
    extract_leading_digit,
)


class TestBenfordTheory:

    def test_benford_theoretical_distribution_sums_to_one(self):
        """Theoretical Benford probabilities for digits 1..9 must sum to 1.0."""
        total_prob = sum(BENFORD_THEORETICAL.values())
        assert total_prob == pytest.approx(1.0, abs=1e-6)
        assert BENFORD_THEORETICAL[1] > BENFORD_THEORETICAL[2] > BENFORD_THEORETICAL[9]
        assert BENFORD_THEORETICAL[1] == pytest.approx(0.30103, abs=1e-4)


class TestLeadingDigitExtraction:

    def test_extract_leading_digit_various_formats(self):
        """Correctly extract the first non-zero digit across number types and formats."""
        assert extract_leading_digit(12450.50) == 1
        assert extract_leading_digit(Decimal("5000.00")) == 5
        assert extract_leading_digit(0.08) == 8
        assert extract_leading_digit("-950.25") == 9
        assert extract_leading_digit("₹4,200.00") == 4
        assert extract_leading_digit(0) is None
        assert extract_leading_digit(None) is None
        assert extract_leading_digit("") is None


class TestBenfordChiSquare:

    def test_fabricated_round_numbers_flagged_as_high_risk(self):
        """
        Amounts with heavily clustered digits (e.g. fabricated invoices starting with 5 or 9)
        must trigger a statistically significant Chi-Square test (p < 0.01, high risk).
        """
        # Fabricated dataset: 100 invoices, 80 starting with '5', 20 starting with '9'
        fabricated_amounts = [5000.0] * 80 + [9000.0] * 20
        chi2, p_val, risk_level, breakdown = benford_chi_square_test(fabricated_amounts)

        assert chi2 > 20.09  # 99th percentile critical value for df=8
        assert p_val < 0.01
        assert risk_level == "high"

        # Check breakdown for digit 5
        d5 = next(item for item in breakdown if item["digit"] == 5)
        assert d5["observed_count"] == 80
        assert d5["residual"] > 0

    def test_natural_benford_distributed_amounts_pass_as_low_risk(self):
        """
        Synthetic financial amounts following Benford's Law (e.g. 10^U where U ~ Uniform(2, 6))
        must conform to the distribution with p >= 0.05 (low risk).
        """
        # Generate 1000 Benford-distributed numbers: 10^Uniform
        np.random.seed(42)
        exponents = np.random.uniform(2.0, 6.0, 1000)
        benford_amounts = [float(10 ** exp) for exp in exponents]

        chi2, p_val, risk_level, breakdown = benford_chi_square_test(benford_amounts)

        assert p_val >= 0.05
        assert risk_level == "low"

    def test_small_sample_size_returns_insufficient_data(self):
        """Samples under 10 records return 'insufficient_data' to prevent false alarms."""
        small_amounts = [100.0, 200.0, 300.0]
        chi2, p_val, risk_level, breakdown = benford_chi_square_test(small_amounts)

        assert risk_level == "insufficient_data"
        assert p_val == 1.0


class TestAntibenfordCounterparties:

    def test_detect_antibenford_counterparties(self):
        """Counterparties with abnormally high leading-digit clustering are flagged."""
        class MockInvoice:
            def __init__(self, cp, amt):
                self.counterparty_name = cp
                self.total_amount = Decimal(str(amt))
                self.expected_net_amount = Decimal(str(amt))

        invoices = [
            # Vendor A: 5 invoices all starting with '9' (suspicious clustering)
            MockInvoice("Vendor A", 9200.00),
            MockInvoice("Vendor A", 9500.00),
            MockInvoice("Vendor A", 9100.00),
            MockInvoice("Vendor A", 9800.00),
            MockInvoice("Vendor A", 9900.00),
            # Vendor B: Naturally distributed invoices
            MockInvoice("Vendor B", 1200.00),
            MockInvoice("Vendor B", 2400.00),
            MockInvoice("Vendor B", 3500.00),
            MockInvoice("Vendor B", 4100.00),
        ]

        flagged = detect_antibenford_counterparties(invoices, threshold_ratio=0.60, min_invoices=3)

        assert len(flagged) == 1
        assert flagged[0]["counterparty_name"] == "Vendor A"
        assert flagged[0]["dominant_leading_digit"] == 9
        assert flagged[0]["dominant_ratio"] == 100.0
        assert "Vendor B" not in [f["counterparty_name"] for f in flagged]
