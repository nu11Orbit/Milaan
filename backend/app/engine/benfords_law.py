"""
engine/benfords_law.py
Benford's Law Forensic Integrity & Anomaly Overlay
===================================================

Performs statistical goodness-of-fit testing against the theoretical Benford
distribution (first-digit law) across batch invoice and transaction amounts.

Theory
------
In naturally occurring financial accounting data, the probability P(d) that
the leading non-zero digit of an amount equals d ∈ {1, 2, ..., 9} follows:
    P(d) = log10(1 + 1/d)

Specifically:
  Digit 1: 30.1%    Digit 4: 9.7%     Digit 7: 5.8%
  Digit 2: 17.6%    Digit 5: 7.9%     Digit 8: 5.1%
  Digit 3: 12.5%    Digit 6: 6.7%     Digit 9: 4.6%

Forensic Application
--------------------
Benford's Law is used by ICAI (Institute of Chartered Accountants of India)
forensic auditors, the IRS, and Big-4 audit firms to detect:
  • Fabricated invoices (round numbers, manual estimations)
  • Invoice split structuring to evade threshold authorization limits
  • Systematic internal accounting anomalies

Chi-Square Goodness-of-Fit Test:
    χ² = Σ_{d=1}^9 (O_d - E_d)² / E_d   (degrees of freedom = 8)
    p-value computed via Chi-Square survival function (sf).

Risk Levels:
  • p ≥ 0.05       → LOW RISK (Conforms to natural distribution)
  • 0.01 ≤ p < 0.05 → MEDIUM RISK (Moderate anomaly / check suspicious counterparties)
  • p < 0.01       → HIGH RISK (Statistically significant deviation / potential fabrication)

Antibenford Subgraph Overlay (arXiv:2205.13426):
  Flags counterparties/vendors where ≥60% of invoices cluster on the same
  leading digit (min 3 invoices).

References
----------
• Nigrini, M. J. (2012). "Benford's Law: Applications for Forensic Accounting, Auditing, and Fraud Detection." John Wiley & Sons.
• arXiv:2205.13426 — "Antibenford Subgraphs: Finding Anomalies in Transaction Graphs"
"""

from __future__ import annotations

import logging
import math
from decimal import Decimal
from typing import Any, Dict, List, Optional, Tuple, Union

import numpy as np
from scipy.stats import chi2

from app.models.bank_transaction import BankTransaction
from app.models.invoice import Invoice

log = logging.getLogger(__name__)

# Theoretical Benford distribution for leading digits 1 to 9
BENFORD_THEORETICAL: Dict[int, float] = {
    d: math.log10(1.0 + 1.0 / d) for d in range(1, 10)
}


def extract_leading_digit(amount: Union[Decimal, float, int, str]) -> Optional[int]:
    """
    Extract the first non-zero digit from an amount.

    Examples:
      5000.00   -> 5
      0.08      -> 8
      12450.50  -> 1
      -950.00   -> 9
      0 or null -> None
    """
    if amount is None:
        return None
    try:
        s = str(amount).replace("-", "").replace("+", "").replace(",", "").strip()
        for char in s:
            if char in "123456789":
                return int(char)
        return None
    except Exception:
        return None


def compute_benford_distribution(
    amounts: List[Union[Decimal, float, int]],
) -> Tuple[Dict[int, int], Dict[int, float], int]:
    """
    Count occurrences of each leading digit and compute observed frequencies.

    Returns
    -------
    (counts_dict, observed_freq_dict, total_valid_samples)
    """
    counts = {d: 0 for d in range(1, 10)}
    total = 0

    for amt in amounts:
        d = extract_leading_digit(amt)
        if d is not None:
            counts[d] += 1
            total += 1

    if total == 0:
        observed = {d: 0.0 for d in range(1, 10)}
    else:
        observed = {d: round(counts[d] / total, 4) for d in range(1, 10)}

    return counts, observed, total


def benford_chi_square_test(
    amounts: List[Union[Decimal, float, int]],
) -> Tuple[float, float, str, List[Dict]]:
    """
    Run Chi-Square goodness-of-fit test against theoretical Benford distribution.

    Parameters
    ----------
    amounts : List of financial amounts (invoices or transactions)

    Returns
    -------
    (chi2_statistic, p_value, risk_level, digit_breakdown)
    """
    counts, observed, total = compute_benford_distribution(amounts)

    if total < 10:
        # Sample size too small for meaningful chi-square
        breakdown = [
            {
                "digit": d,
                "observed_count": counts[d],
                "observed_pct": round(observed[d] * 100, 1),
                "expected_pct": round(BENFORD_THEORETICAL[d] * 100, 1),
                "residual": 0.0,
            }
            for d in range(1, 10)
        ]
        return 0.0, 1.0, "insufficient_data", breakdown

    chi2_stat = 0.0
    breakdown = []

    for d in range(1, 10):
        obs = counts[d]
        exp = total * BENFORD_THEORETICAL[d]
        diff = obs - exp
        chi2_stat += (diff ** 2) / exp

        breakdown.append({
            "digit": d,
            "observed_count": obs,
            "observed_pct": round(observed[d] * 100, 1),
            "expected_pct": round(BENFORD_THEORETICAL[d] * 100, 1),
            "residual": round((obs - exp) / math.sqrt(exp), 2) if exp > 0 else 0.0,
        })

    # Degrees of freedom for 9 bins = 8
    df = 8
    p_value = float(chi2.sf(chi2_stat, df))

    if p_value >= 0.05:
        risk_level = "low"
    elif p_value >= 0.01:
        risk_level = "medium"
    else:
        risk_level = "high"

    return round(chi2_stat, 2), round(p_value, 4), risk_level, breakdown


def detect_antibenford_counterparties(
    invoices: List[Any],
    threshold_ratio: float = 0.60,
    min_invoices: int = 3,
) -> List[Dict]:
    """
    Identify counterparties whose invoice amounts abnormally cluster on a single leading digit.

    Parameters
    ----------
    invoices        : List of Invoice Beanie documents or InvoiceView objects
    threshold_ratio : Ratio threshold (default: 60% of invoices have same leading digit)
    min_invoices    : Minimum invoice count for a counterparty to be evaluated (default: 3)

    Returns
    -------
    List of suspicious counterparty summary dicts
    """
    cp_amounts: Dict[str, List[Decimal]] = {}

    for inv in invoices:
        cp_name = getattr(inv, "counterparty_name", None)
        amt = getattr(inv, "total_amount", None) or getattr(inv, "expected_net_amount", None)
        if cp_name and amt:
            cp_amounts.setdefault(cp_name, []).append(amt)

    suspicious = []
    for cp_name, amounts in cp_amounts.items():
        if len(amounts) < min_invoices:
            continue

        digits = [extract_leading_digit(a) for a in amounts if extract_leading_digit(a) is not None]
        if not digits:
            continue

        counts: Dict[int, int] = {}
        for d in digits:
            counts[d] = counts.get(d, 0) + 1

        dominant_digit, dominant_count = max(counts.items(), key=lambda x: x[1])
        ratio = dominant_count / len(digits)

        if ratio >= threshold_ratio:
            suspicious.append({
                "counterparty_name": cp_name,
                "total_invoices": len(amounts),
                "dominant_leading_digit": dominant_digit,
                "dominant_digit_count": dominant_count,
                "dominant_ratio": round(ratio * 100, 1),
                "total_amount_sum": str(sum(amounts)),
                "flag_reason": (
                    f"{dominant_count} of {len(amounts)} invoices ({round(ratio*100)}%) "
                    f"start with digit '{dominant_digit}'. Expected under Benford: {round(BENFORD_THEORETICAL[dominant_digit]*100, 1)}%."
                ),
            })

    # Sort most suspicious first
    suspicious.sort(key=lambda x: (x["dominant_ratio"], x["total_invoices"]), reverse=True)
    return suspicious


# ─────────────────────────────────────────────────────────────────────────────
# Database-Aware Integrity Analysis
# ─────────────────────────────────────────────────────────────────────────────

async def run_benford_integrity_analysis(batch_id: str) -> Dict:
    """
    Run full Benford's Law forensic analysis across all invoices and transactions in a batch.
    """
    invoices = await Invoice.find(Invoice.batch_id == batch_id).to_list()
    txns = await BankTransaction.find(BankTransaction.batch_id == batch_id).to_list()

    if not invoices and not txns:
        return {
            "batch_id": batch_id,
            "error": "No invoices or bank transactions found for this batch.",
            "status": "empty",
        }

    # Analyze invoice amounts
    inv_amounts = [
        inv.total_amount or inv.expected_net_amount or inv.base_amount
        for inv in invoices
        if (inv.total_amount or inv.expected_net_amount or inv.base_amount) is not None
    ]
    inv_chi2, inv_p, inv_risk, inv_breakdown = benford_chi_square_test(inv_amounts)

    # Analyze bank transaction amounts
    txn_amounts = [t.amount for t in txns if t.amount is not None]
    txn_chi2, txn_p, txn_risk, txn_breakdown = benford_chi_square_test(txn_amounts)

    # Detect clustered counterparties
    suspicious_cps = detect_antibenford_counterparties(invoices)

    # Overall batch risk determination
    if inv_risk == "high" or txn_risk == "high" or len(suspicious_cps) >= 3:
        overall_risk = "high"
    elif inv_risk == "medium" or txn_risk == "medium" or len(suspicious_cps) >= 1:
        overall_risk = "medium"
    else:
        overall_risk = "low"

    return {
        "batch_id": batch_id,
        "overall_fraud_risk": overall_risk,
        "sample_counts": {
            "invoices_analyzed": len(inv_amounts),
            "transactions_analyzed": len(txn_amounts),
        },
        "invoice_analysis": {
            "chi2_statistic": inv_chi2,
            "p_value": inv_p,
            "risk_level": inv_risk,
            "digit_distribution": inv_breakdown,
        },
        "transaction_analysis": {
            "chi2_statistic": txn_chi2,
            "p_value": txn_p,
            "risk_level": txn_risk,
            "digit_distribution": txn_breakdown,
        },
        "suspicious_counterparties_count": len(suspicious_cps),
        "suspicious_counterparties": suspicious_cps,
        "methodology": (
            "Goodness-of-fit against theoretical Benford's Law distribution (df=8, alpha=0.05). "
            "Statistically significant p-values (p < 0.05) flag potential invoice fabrication, "
            "round-number padding, or authorization threshold evasion."
        ),
    }
