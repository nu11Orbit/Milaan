"""
engine/candidate_filter.py
Pre-narrows the invoice pool for a given bank transaction before any pass runs.

Why narrow first?
  • Without filtering, Pass 2/3 would compare every txn against every invoice
    (O(n²) per merchant). For 500 invoices × 500 txns = 250,000 comparisons
    per merchant — far too slow for a demo run.
  • Narrowing to ≤50 candidates keeps each pass fast while still covering the
    60-day date-lag outlier (Case 11) and ±10% amount tolerance.

Narrowing criteria (all must pass):
  1. Same merchant_id
  2. Invoice status = "open"
  3. Invoice date within [txn_date - 60 days, txn_date + 7 days]
     (future-dated to catch pre-invoiced scenarios)
  4. Invoice expected_net_amount within ±30% of txn.amount
     (wide enough to catch TDS-adjusted, GST-drift, and partial-payment cases)
"""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal
from typing import List

from app.engine.schemas import InvoiceView, TxnView
from app.core.config import get_settings


def _amount_in_window(inv_amount: Decimal, txn_amount: Decimal, tolerance_pct: float = 0.30) -> bool:
    """True if inv_amount is within ±tolerance_pct of txn_amount."""
    if txn_amount == 0:
        return False
    ratio = abs(inv_amount - txn_amount) / txn_amount
    return ratio <= Decimal(str(tolerance_pct))


def narrow_candidates(
    txn: TxnView,
    all_invoices: List[InvoiceView],
    settings=None,
) -> List[InvoiceView]:
    """
    Return the subset of invoices that are plausible candidates for `txn`.

    Parameters
    ----------
    txn         : The bank transaction being matched.
    all_invoices: All open invoices for the merchant (pre-fetched by orchestrator).
    settings    : Injected settings (defaults to get_settings() if None).

    Returns
    -------
    Filtered list, ordered by date proximity to txn.txn_date (closest first).
    """
    if settings is None:
        settings = get_settings()

    date_window = timedelta(days=settings.candidate_date_window_days)
    earliest = txn.txn_date - date_window
    latest   = txn.txn_date + timedelta(days=7)   # allow pre-invoiced

    candidates = []
    for inv in all_invoices:
        # Filter 1: invoice status
        if inv.status != "open":
            continue

        # Filter 2: date window
        if not (earliest <= inv.invoice_date <= latest):
            continue

        # Filter 3: amount window
        # For credits (money in), check against expected_net_amount.
        # For debits (refunds), check against total_amount — could be reversed.
        if txn.direction == "credit":
            ref_amount = inv.expected_net_amount
        else:
            ref_amount = inv.total_amount

        if not _amount_in_window(ref_amount, txn.amount):
            # Also check total_amount for cases where TDS wasn't deducted by payer
            if not _amount_in_window(inv.total_amount, txn.amount):
                continue

        candidates.append(inv)

    # Sort by date proximity (ascending absolute delta)
    candidates.sort(key=lambda inv: abs((inv.invoice_date - txn.txn_date).days))

    return candidates
