"""
engine/pass1_rules.py
Pass 1 — Deterministic Rules Engine
=====================================

Five rules applied in descending certainty order.
Each fired rule adds points to the candidate's score.

Rule scoring table
──────────────────
Rule 1  UTR / reference exact match       → +40 pts  (near-certain signal)
Rule 2  Amount exact (≤ ₹2 tolerance)     → +30 pts
Rule 3  Formula-derived amount match      → +25 pts  (TDS / GST / gateway fee)
Rule 4  Date proximity                    → +5 to +15 pts
Rule 5  Counterparty basic string match   → +5 to +10 pts

A candidate scoring ≥ 70 after Pass 1 is forwarded directly to the
confidence scorer (skip Passes 2-4).  Below 70 → continues to Pass 2.

Pass 1 does NOT eliminate any candidate from further consideration —
it only adds positive score contributions.  Low-scoring candidates
proceed to Pass 2 unchanged.
"""

from __future__ import annotations

from decimal import Decimal
from typing import List, Optional, Tuple

from app.engine.schemas import CandidateMatch, InvoiceView, TxnView
from app.core.config import get_settings

# ── Pass 1 resolution threshold (score ≥ this → skip passes 2-4) ─────────────
PASS1_RESOLVE_THRESHOLD = 70.0


# ── Helper: reference number comparison ──────────────────────────────────────

def _refs_match(txn_ref: Optional[str], inv_ref: Optional[str]) -> Tuple[bool, str]:
    """
    Compare reference numbers with tolerance for truncation.
    Returns (matched, reason_string).

    Rules:
    - Both None → no signal (not a match, not a mismatch)
    - Either None → no signal
    - Both present, same value → exact match
    - Both present, one is prefix of other (min 6 chars) → partial match
    """
    if not txn_ref or not inv_ref:
        return False, ""

    # Normalise: strip whitespace, uppercase
    t = txn_ref.strip().upper()
    i = inv_ref.strip().upper()

    if t == i:
        return True, f"UTR/reference exact match ({t})"

    # One is a prefix of the other (truncation case)
    min_len = 6
    if len(t) >= min_len and len(i) >= min_len:
        if i.startswith(t) or t.startswith(i):
            shorter = t if len(t) < len(i) else i
            return True, f"UTR prefix match ({shorter}…)"

    return False, ""


def _amount_close(a: Decimal, b: Decimal, tolerance: Decimal) -> bool:
    return abs(a - b) <= tolerance


# ── Rule functions ─────────────────────────────────────────────────────────────

def rule1_utr_exact(candidate: CandidateMatch, txn: TxnView, inv: InvoiceView) -> None:
    """Rule 1: Reference / UTR number match (+40 pts for exact, +20 for prefix)."""
    matched, reason = _refs_match(txn.reference_number, inv.reference_number)
    if matched:
        # Distinguish exact vs prefix
        is_exact = (
            txn.reference_number and inv.reference_number and
            txn.reference_number.strip().upper() == inv.reference_number.strip().upper()
        )
        delta = 40.0 if is_exact else 20.0
        candidate.add("pass1_utr", delta, reason)
    else:
        candidate.add("pass1_utr", 0.0, "No UTR/reference signal", fired=False)


def rule2_amount_exact(
    candidate: CandidateMatch,
    txn: TxnView,
    inv: InvoiceView,
    settings=None,
) -> None:
    """
    Rule 2: Amount exact match within tolerance.
    Checks txn.amount against:
      a) invoice.expected_net_amount  (primary — after TDS)
      b) invoice.total_amount         (secondary — payer may not deduct TDS)
    """
    if settings is None:
        settings = get_settings()
    tol = Decimal(str(settings.amount_tolerance_rupees))

    if _amount_close(txn.amount, inv.expected_net_amount, tol):
        delta = 30.0
        reason = (
            f"Amount exact match: txn ₹{txn.amount} ≈ expected_net ₹{inv.expected_net_amount} "
            f"(within ₹{tol})"
        )
        candidate.add("pass1_amount_exact", delta, reason)
    elif _amount_close(txn.amount, inv.total_amount, tol):
        # Payer sent gross amount (didn't deduct TDS) — still a strong signal
        delta = 22.0
        reason = (
            f"Amount matches gross total: txn ₹{txn.amount} ≈ total ₹{inv.total_amount} "
            f"(TDS possibly handled separately)"
        )
        candidate.add("pass1_amount_gross", delta, reason)
    else:
        candidate.add("pass1_amount_exact", 0.0, "Amount not within tolerance", fired=False)


def rule3_formula_amount(
    candidate: CandidateMatch,
    txn: TxnView,
    inv: InvoiceView,
) -> None:
    """
    Rule 3: Formula-derived amount checks.

    Checks (in priority order):
      a) TDS-adjusted: txn ≈ total - tds_amount
      b) GST rounding: txn ≈ expected_net ± ₹2 (already covered by Rule 2, skip)
      c) Gateway fee:  txn ≈ expected_net × (1 - 0.0236) [Razorpay UPI fee]
    """
    TWO_RUPEES = Decimal("2")
    GATEWAY_EFFECTIVE = Decimal("0.0236")

    fired_any = False

    # (a) TDS-adjusted
    if inv.tds_amount and inv.tds_amount > 0:
        tds_adjusted = inv.total_amount - inv.tds_amount
        if _amount_close(txn.amount, tds_adjusted, TWO_RUPEES):
            candidate.add(
                "pass1_tds_adjusted", 25.0,
                f"Amount matches TDS-adjusted total: "
                f"₹{inv.total_amount} - TDS ₹{inv.tds_amount} = ₹{tds_adjusted} "
                f"(section {inv.tds_section or 'N/A'})",
            )
            fired_any = True

    # (b) Gateway fee deduction (only relevant for UPI channel)
    if not fired_any and txn.channel == "UPI":
        after_fee = (inv.expected_net_amount * (1 - GATEWAY_EFFECTIVE)).quantize(Decimal("0.01"))
        if _amount_close(txn.amount, after_fee, TWO_RUPEES):
            candidate.add(
                "pass1_gateway_fee", 22.0,
                f"Amount matches post-gateway-fee net: "
                f"₹{inv.expected_net_amount} × (1-2.36%) = ₹{after_fee}",
            )
            fired_any = True

    if not fired_any:
        candidate.add("pass1_formula", 0.0, "No formula-derived amount match", fired=False)


def rule4_date_proximity(
    candidate: CandidateMatch,
    txn: TxnView,
    inv: InvoiceView,
) -> None:
    """
    Rule 4: Date proximity (smaller gap → higher points).
    ≤7 days  → +15 pts (normal payment cycle)
    8-30 days → +10 pts
    31-60 days → +5 pts (date lag outlier case 11)
    > 60 days  → +0 pts (suspicious — but not eliminated here)
    """
    delta_days = abs((txn.txn_date - inv.invoice_date).days)
    if delta_days <= 7:
        candidate.add("pass1_date", 15.0, f"Payment within 7 days of invoice ({delta_days}d)")
    elif delta_days <= 30:
        candidate.add("pass1_date", 10.0, f"Payment within 30 days of invoice ({delta_days}d)")
    elif delta_days <= 60:
        candidate.add("pass1_date", 5.0,  f"Payment within 60 days of invoice ({delta_days}d)")
    else:
        candidate.add("pass1_date", 0.0,  f"Date gap {delta_days}d exceeds 60-day window", fired=False)


def rule5_counterparty_basic(
    candidate: CandidateMatch,
    txn: TxnView,
    inv: InvoiceView,
) -> None:
    """
    Rule 5: Basic counterparty name signal.
    Checks if ANY token from the invoice counterparty name appears in the narration.
    This is intentionally loose — Pass 2 (rapidfuzz) handles the proper fuzzy match.
    """
    narration_upper = txn.narration.upper()
    name_tokens = [
        t for t in inv.counterparty_name.upper().split()
        if len(t) >= 4 and t not in {"PRIVATE", "LIMITED", "PVT", "LTD", "SERVICES",
                                      "SOLUTIONS", "ENTERPRISES", "TRADING"}
    ]
    for token in name_tokens:
        if token[:4] in narration_upper:   # first 4 chars of each meaningful word
            candidate.add(
                "pass1_name_token", 10.0,
                f"Counterparty token '{token[:4]}' found in narration",
            )
            return

    candidate.add("pass1_name_token", 0.0, "No counterparty name token in narration", fired=False)


# ── Main Pass 1 function ───────────────────────────────────────────────────────

def run_pass1(
    txn: TxnView,
    candidates: List[InvoiceView],
    settings=None,
) -> List[CandidateMatch]:
    """
    Run all 5 rules against every candidate invoice for this transaction.

    Returns a list of CandidateMatch objects, sorted by score descending.
    Caller (orchestrator) decides what to do with scores above/below threshold.

    Parameters
    ----------
    txn        : Bank transaction being matched.
    candidates : Pre-narrowed invoice candidates (from candidate_filter).
    settings   : Injected settings (defaults to get_settings()).

    Returns
    -------
    List of CandidateMatch, sorted by score descending.
    Top candidate score ≥ PASS1_RESOLVE_THRESHOLD → resolved by Pass 1.
    """
    if settings is None:
        settings = get_settings()

    results: List[CandidateMatch] = []

    for inv in candidates:
        cm = CandidateMatch(invoice_id=inv.invoice_id, txn_id=txn.txn_id)

        # Apply rules in descending certainty order
        rule1_utr_exact(cm, txn, inv)
        rule2_amount_exact(cm, txn, inv, settings)
        rule3_formula_amount(cm, txn, inv)
        rule4_date_proximity(cm, txn, inv)
        rule5_counterparty_basic(cm, txn, inv)

        results.append(cm)

    # Sort: highest score first
    results.sort(key=lambda c: c.score, reverse=True)

    # Tag the top candidate if it cleared the threshold
    if results and results[0].score >= PASS1_RESOLVE_THRESHOLD:
        results[0].resolved_by = "pass1_rules"
        results[0].match_type = "one_to_one"

    return results


def exception_no_candidates(txn: TxnView, batch_id: str) -> CandidateMatch:
    """
    Factory for when candidate_filter returned an empty list.
    Creates an exception CandidateMatch for an orphan bank transaction.
    """
    cm = CandidateMatch(
        invoice_id="",
        txn_id=txn.txn_id,
        score=0.0,
        is_exception=True,
        exception_reason_category="no_candidate_found",
        exception_reason_detail=(
            f"No open invoice found for txn {txn.txn_id} "
            f"(₹{txn.amount}, {txn.txn_date}, {txn.channel}). "
            f"Possible orphan bank credit or data gap."
        ),
        resolved_by="exception",
        match_type="exception",
    )
    return cm
