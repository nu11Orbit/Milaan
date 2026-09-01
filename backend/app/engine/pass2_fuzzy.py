"""
engine/pass2_fuzzy.py
Pass 2 — Fuzzy / Composite Scoring
=====================================

Runs on candidates that Pass 1 left unresolved (score < 70).
Uses three weighted signals:

Signal A  Counterparty name similarity   (rapidfuzz token_sort_ratio)
Signal B  Amount closeness               (Gaussian decay on % difference)
Signal C  Date proximity                 (Gaussian decay on day delta)

Score contributions
───────────────────
Signal A fires if name_ratio ≥ 40% → +0 to +18 pts (scaled linearly)
Signal B fires if amount within 30% → +0 to +12 pts (Gaussian)
Signal C fires if date within 60d   → +0 to +10 pts (Gaussian)

Maximum contribution from Pass 2: +40 pts.
This is intentionally capped below the Pass 1 threshold so a fuzzy match
alone can't clear 70 pts without some signal from Pass 1 as well.

Pass 2 resolves if combined score (Pass 1 + Pass 2) ≥ 70.
Candidates still below 70 → forwarded to Pass 3 (embedding).
"""

from __future__ import annotations

import math
from typing import List, Optional

from rapidfuzz import fuzz

from app.engine.schemas import CandidateMatch, InvoiceView, TxnView
from app.core.config import get_settings

# ── Tunable weights ────────────────────────────────────────────────────────────
MAX_NAME_PTS   = 18.0   # Perfect name similarity
MAX_AMOUNT_PTS = 12.0   # Perfect amount match (already rewarded by Pass 1; this catches near-misses)
MAX_DATE_PTS   = 10.0   # Perfect date proximity

# Gaussian sigma values
AMOUNT_SIGMA_PCT = 0.10   # 10% amount difference = 1 sigma
DATE_SIGMA_DAYS  = 15.0   # 15-day difference = 1 sigma

PASS2_MIN_NAME_RATIO = 40.0   # Below this → no name signal (noise floor)


def _gaussian(x: float, sigma: float) -> float:
    """Gaussian decay: 1.0 at x=0, decays symmetrically."""
    return math.exp(-0.5 * (x / sigma) ** 2)


# ── Signal functions ───────────────────────────────────────────────────────────

def signal_a_name(
    candidate: CandidateMatch,
    txn: TxnView,
    inv: InvoiceView,
) -> None:
    """
    Signal A: counterparty name vs narration fuzzy match.

    Uses token_sort_ratio — handles word-order differences and abbreviations.
    E.g. "ACME PVT LTD" vs "ACMEPVT" in narration gets a decent score.

    Falls back to partial_ratio for very short narration tokens.
    """
    narration_clean = txn.narration.upper()
    # Strip channel prefixes ("UPI/", "NEFT-", etc.) for cleaner comparison
    for prefix in ("UPI/", "NEFT-", "IMPS/", "RTGS/", "CHQ DEP "):
        if narration_clean.startswith(prefix):
            narration_clean = narration_clean[len(prefix):]
            break

    name = inv.counterparty_name.upper()
    ratio_sort  = fuzz.token_sort_ratio(name, narration_clean)
    ratio_part  = fuzz.partial_ratio(name, narration_clean)
    ratio = max(ratio_sort, ratio_part)

    if ratio >= PASS2_MIN_NAME_RATIO:
        # Scale linearly from MIN → 100 to 0 → MAX_NAME_PTS
        pts = MAX_NAME_PTS * (ratio - PASS2_MIN_NAME_RATIO) / (100 - PASS2_MIN_NAME_RATIO)
        candidate.add(
            "pass2_name_fuzzy", round(pts, 2),
            f"Fuzzy name match: '{name[:20]}' vs narration — {ratio:.0f}/100",
        )
    else:
        candidate.add(
            "pass2_name_fuzzy", 0.0,
            f"Name similarity too low ({ratio:.0f}/100 < {PASS2_MIN_NAME_RATIO:.0f})",
            fired=False,
        )


def signal_b_amount(
    candidate: CandidateMatch,
    txn: TxnView,
    inv: InvoiceView,
) -> None:
    """
    Signal B: amount closeness via Gaussian decay on percentage difference.
    Only fires if Pass 1 didn't already resolve the amount exactly.
    """
    if inv.expected_net_amount == 0:
        return
    pct_diff = abs(txn.amount - inv.expected_net_amount) / inv.expected_net_amount
    if float(pct_diff) > 0.30:
        candidate.add("pass2_amount_fuzzy", 0.0, "Amount too far apart for fuzzy signal", fired=False)
        return

    pts = MAX_AMOUNT_PTS * _gaussian(float(pct_diff), AMOUNT_SIGMA_PCT)
    candidate.add(
        "pass2_amount_fuzzy", round(pts, 2),
        f"Amount fuzzy: txn ₹{txn.amount} vs expected ₹{inv.expected_net_amount} "
        f"({float(pct_diff)*100:.1f}% diff)",
    )


def signal_c_date(
    candidate: CandidateMatch,
    txn: TxnView,
    inv: InvoiceView,
) -> None:
    """
    Signal C: date proximity via Gaussian decay on day delta.
    Complements Pass 1's step-function date scoring with a smooth curve.
    """
    delta_days = abs((txn.txn_date - inv.invoice_date).days)
    if delta_days > 60:
        candidate.add("pass2_date_fuzzy", 0.0, f"Date gap {delta_days}d too large", fired=False)
        return

    pts = MAX_DATE_PTS * _gaussian(float(delta_days), DATE_SIGMA_DAYS)
    candidate.add(
        "pass2_date_fuzzy", round(pts, 2),
        f"Date proximity: {delta_days}d between txn and invoice",
    )


# ── Main Pass 2 function ───────────────────────────────────────────────────────

PASS2_RESOLVE_THRESHOLD = 70.0   # Combined (Pass 1 + Pass 2) score needed to resolve


def run_pass2(
    txn: TxnView,
    candidates: List[CandidateMatch],
    all_invoices_by_id: dict,  # invoice_id → InvoiceView
) -> List[CandidateMatch]:
    """
    Apply fuzzy signals to candidates not yet resolved by Pass 1.

    Parameters
    ----------
    txn               : Bank transaction being matched.
    candidates        : CandidateMatch list from run_pass1() (sorted desc by score).
    all_invoices_by_id: Lookup dict {invoice_id: InvoiceView}.

    Returns
    -------
    Updated candidates list (same objects, modified in-place), still sorted desc.
    Candidates with combined score ≥ 70 are tagged resolved_by='pass2_fuzzy'.
    """
    for cm in candidates:
        if cm.resolved_by is not None:
            continue   # Already resolved by Pass 1

        inv = all_invoices_by_id.get(cm.invoice_id)
        if inv is None:
            continue

        signal_a_name(cm, txn, inv)
        signal_b_amount(cm, txn, inv)
        signal_c_date(cm, txn, inv)

        if cm.score >= PASS2_RESOLVE_THRESHOLD:
            amount_matched = any(
                c.source in ("pass1_amount_exact", "pass1_amount_gross", "pass1_tds_adjusted", "pass1_gateway_fee", "pass2_amount_fuzzy") and c.rule_fired
                for c in cm.contributions
            )
            if amount_matched:
                cm.resolved_by = "pass2_fuzzy"
                cm.match_type  = "one_to_one"

    # Re-sort after score updates
    candidates.sort(key=lambda c: c.score, reverse=True)
    return candidates
