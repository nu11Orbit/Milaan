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


def _amount_in_window(inv_amount: Decimal, txn_amount: Decimal, tolerance_pct: float = 0.60) -> bool:
    """
    True if inv_amount is within ±tolerance_pct of txn_amount.

    Why 60% (not the original 30%):
      - Split payments: a ₹25k txn against a ₹50k invoice is 100% ratio — clearly
        outside 30% but is a valid split candidate for Pass 4.
      - Batch payouts: a ₹120k txn against ₹70k + ₹50k invoices requires both
        ₹70k and ₹50k to pass through the filter before Pass 4 can sum them.
      - TDS/GST drift: typically ≤10% but safe to be wide here since Pass 1-3
        scoring will correctly rank candidates by actual amount similarity.
      - 60% admits a 2× relationship (covers most split/batch scenarios) while
        still excluding obviously unrelated invoices (e.g. ₹25k vs ₹80k = 220%).
    """
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

        # Direct signal: if narration explicitly mentions this invoice ID or counterparty,
        # always include as a candidate regardless of amount difference (critical for split/batch).
        id_match = bool(inv.invoice_id and inv.invoice_id.strip() and inv.invoice_id.upper() in txn.narration.upper())
        name_match = False
        if inv.counterparty_name and len(inv.counterparty_name.strip()) >= 3:
            name_clean = inv.counterparty_name.strip().upper()
            if name_clean in txn.narration.upper() or any(
                t in txn.narration.upper() for t in name_clean.split()
                if len(t) >= 4 and t not in {"PRIVATE", "LIMITED", "PVT", "LTD", "SERVICES", "SOLUTIONS"}
            ):
                name_match = True

        if not (id_match or name_match):
            ref_amount = inv.expected_net_amount if txn.direction == "credit" else inv.total_amount
            # Amount window check: ratio up to 1.5 (covers 2x to 3x split & batch payments)
            if not _amount_in_window(ref_amount, txn.amount, tolerance_pct=1.5):
                if not _amount_in_window(inv.total_amount, txn.amount, tolerance_pct=1.5):
                    if not _amount_in_window(txn.amount, ref_amount, tolerance_pct=1.5):
                        continue

        candidates.append(inv)

    # Sort by date proximity (ascending absolute delta)
    candidates.sort(key=lambda inv: abs((inv.invoice_date - txn.txn_date).days))

    return candidates
