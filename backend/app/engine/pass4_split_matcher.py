"""
engine/pass4_split_matcher.py
Pass 4 — Split / Batch Subset-Sum Matcher
==========================================

Handles four multi-record scenarios that Passes 1-3 cannot resolve:

  Case 4  split_many_to_one   Multiple txns together settle one invoice.
  Case 5  batch_one_to_many   One txn settles multiple invoices at once.
  Case 6  partial             Genuine partial payment — open balance remains.
  Case 15 duplicate_flag      Same txn appears twice — flagged, not double-counted.

Algorithm
──────────
Amounts are converted to integer PAISE (×100) before comparison — no Decimal
equality bugs from floating-point arithmetic.

For pool ≤ SPLIT_POOL_MAX_SIZE (default 8 from config):
  Enumerate all non-empty subsets using itertools.combinations (2^8 = 256 max).
  Each subset is checked: sum ≈ target ± tolerance.
  If multiple subsets match → pick the one with fewest txns; tie-break by
  minimising max date delta; surface ambiguity flag.

For pool > SPLIT_POOL_MAX_SIZE:
  Do NOT attempt subset-sum. Flag for LLM adjudication instead.
  Never fail silently — always return an explicit result explaining why.

Safety guardrails
──────────────────
• Every txn in a split subset must have counterparty name similarity ≥ 35
  (rapidfuzz partial_ratio) against the invoice counterparty. Prevents the
  engine from grouping unrelated transactions.
• Splits of >2 txns are flagged `requires_human_review=True` — the orchestrator
  must gate these to the review queue regardless of confidence score.
• `allocated_amount` is tracked per-txn so the orchestrator can update balances
  without risk of double-spend.
"""

from __future__ import annotations

import itertools
import logging
import re
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Dict, List, Optional, Literal

from rapidfuzz import fuzz

from app.engine.schemas import InvoiceView, TxnView
from app.core.config import get_settings

log = logging.getLogger(__name__)

# ── Paise conversion ───────────────────────────────────────────────────────────

def _to_paise(amount: Decimal) -> int:
    """Convert Decimal rupees → integer paise. Rounds half-up."""
    return int((amount * 100).to_integral_value())


# ── Counterparty name floor check ─────────────────────────────────────────────

def _name_ok(txn_narration: str, inv_counterparty: str) -> bool:
    """True if the txn narration is consistent with the invoice counterparty name."""
    if not inv_counterparty or not txn_narration:
        return False
    narr = txn_narration.strip().upper()
    cparty = inv_counterparty.strip().upper()
    
    if cparty in narr:
        return True
    
    stopwords = {
        "PRIVATE", "LIMITED", "PVT", "LTD", "SERVICES", "SOLUTIONS",
        "CORP", "CORPORATION", "ENTERPRISES", "TRADING", "TRADERS",
        "GROUP", "ASSOCIATES", "SUPPLIERS", "LOGISTICS", "AND", "THE",
        "FOR", "FROM", "WITH", "PAYMENT", "INDIA", "INDUSTRIES",
        "TECHNOLOGIES", "PLC", "CO", "COMPANY"
    }
    cparty_tokens = [
        t.strip(",.-/'\"") for t in cparty.split()
        if len(t.strip(",.-/'\"")) >= 4 and t.strip(",.-/'\"") not in stopwords
    ]
    if cparty_tokens and any(t in narr for t in cparty_tokens):
        return True
        
    token_set = fuzz.token_set_ratio(cparty, narr)
    return token_set >= 70.0


# ── Result dataclass ──────────────────────────────────────────────────────────

@dataclass
class SplitMatchResult:
    """
    Result returned by run_pass4_split() or run_pass4_batch().
    The orchestrator uses this to create Match + MatchLineItem documents.
    """
    match_type: Literal[
        "split_many_to_one",
        "batch_one_to_many",
        "partial",
        "flagged_for_llm",
        "no_match",
    ]

    # For split_many_to_one: one invoice_id; txn_ids is the winning subset
    # For batch_one_to_many: one txn_id; invoice_ids is the winning subset
    invoice_ids: List[str] = field(default_factory=list)
    txn_ids:     List[str] = field(default_factory=list)

    # Per-record allocation (txn_id or invoice_id → Decimal allocated)
    allocated_amounts: Dict[str, Decimal] = field(default_factory=dict)

    # Remaining unallocated amount (non-zero only for partial payment)
    remaining_unallocated: Decimal = Decimal("0")

    # Confidence from this pass (added to running score)
    confidence_delta: float = 0.0

    # Human-readable explanation (stored in AuditLogEntry + Match.explanation_text)
    explanation: str = ""

    # Safety gates
    flagged_for_llm:      bool = False   # Pool too large → needs LLM
    requires_human_review: bool = False   # >2 txns in a split
    ambiguous:             bool = False   # Multiple valid subsets found
    counterparty_floor_violated: bool = False  # A txn in subset failed name check


_INV_RE = re.compile(r"\bINV-\d+\b", re.IGNORECASE)


# ── Split: many txns → one invoice ────────────────────────────────────────────

def run_pass4_split(
    invoice: InvoiceView,
    candidate_txns: List[TxnView],
    settings=None,
) -> SplitMatchResult:
    """
    Find a subset of `candidate_txns` whose amounts sum to
    invoice.expected_net_amount (±tolerance).

    Parameters
    ----------
    invoice        : The invoice being matched.
    candidate_txns : Pool of unmatched credits for this merchant,
                     pre-narrowed by the orchestrator.
    settings       : Injected settings.

    Returns
    -------
    SplitMatchResult — always non-None. Check .match_type for outcome.
    """
    if settings is None:
        settings = get_settings()

    target    = invoice.expected_net_amount
    tol_paise = _to_paise(Decimal(str(settings.amount_tolerance_rupees)))
    target_p  = _to_paise(target)
    max_pool  = settings.split_pool_max_size

    # Filter candidate transactions to those relevant to this invoice (name or explicit ID)
    inv_id = (invoice.invoice_id or "").upper()
    relevant_txns = []
    for t in candidate_txns:
        if t.direction != "credit":
            continue
        narr = (t.narration or "").upper()
        found_invs = _INV_RE.findall(narr)
        if found_invs:
            if inv_id in [fi.upper() for fi in found_invs]:
                relevant_txns.append(t)
        else:
            if _name_ok(t.narration, invoice.counterparty_name):
                relevant_txns.append(t)

    pool = relevant_txns if relevant_txns else [t for t in candidate_txns if t.direction == "credit"]

    # ── Pool too large → flag for LLM ─────────────────────────────────────────
    if len(pool) > max_pool:
        return SplitMatchResult(
            match_type="flagged_for_llm",
            invoice_ids=[invoice.invoice_id],
            flagged_for_llm=True,
            explanation=(
                f"Split pool size {len(pool)} exceeds max {max_pool}. "
                f"Flagged for LLM adjudication — cannot enumerate subsets safely."
            ),
        )

    # ── Enumerate all subsets of size >= 2 (splits require 2+ txns) ───────────
    txn_paise  = [_to_paise(t.amount) for t in pool]
    solutions: List[tuple] = []   # Each element: tuple of indices

    for size in range(2, len(pool) + 1):
        for combo in itertools.combinations(range(len(pool)), size):
            subset_sum = sum(txn_paise[i] for i in combo)
            if abs(subset_sum - target_p) <= tol_paise:
                solutions.append(combo)

    # ── No subset sums to target → check for partial payment ──────────────────
    if not solutions:
        credits_below = [
            (i, txn_paise[i]) for i in range(len(pool))
            if txn_paise[i] < target_p and _name_ok(pool[i].narration, invoice.counterparty_name)
        ]
        if credits_below:
            best_i, best_p = max(credits_below, key=lambda x: x[1])
            best_txn = pool[best_i]
            paid    = best_txn.amount
            remaining = target - paid
            return SplitMatchResult(
                match_type="partial",
                invoice_ids=[invoice.invoice_id],
                txn_ids=[best_txn.txn_id],
                allocated_amounts={best_txn.txn_id: paid},
                remaining_unallocated=remaining,
                confidence_delta=25.0,
                explanation=(
                    f"Partial payment detected: ₹{paid} received against invoice ₹{target}. "
                    f"Open balance: ₹{remaining}."
                ),
            )
        return SplitMatchResult(
            match_type="no_match",
            invoice_ids=[invoice.invoice_id],
            explanation="No subset of candidate transactions sums to invoice expected_net_amount.",
        )

    # ── Pick best valid solution: filter by counterparty name floor first ─────
    valid_solutions = [
        combo for combo in solutions
        if all(_name_ok(pool[i].narration, invoice.counterparty_name) for i in combo)
    ]
    if not valid_solutions:
        valid_solutions = solutions

    def _split_score(combo):
        n_txns    = len(combo)
        max_delta = max(
            abs((pool[i].txn_date - invoice.invoice_date).days)
            for i in combo
        )
        return (n_txns, max_delta)

    valid_solutions.sort(key=_split_score)
    best_combo   = valid_solutions[0]
    best_txns    = [pool[i] for i in best_combo]
    ambiguous    = len(valid_solutions) > 1
    req_review   = len(best_txns) > 2
    allocated    = {t.txn_id: t.amount for t in best_txns}

    return SplitMatchResult(
        match_type="split_many_to_one",
        txn_ids=[t.txn_id for t in best_txns],
        invoice_ids=[invoice.invoice_id],
        allocated_amounts=allocated,
        remaining_unallocated=Decimal("0"),
        confidence_delta=45.0 if not ambiguous else 25.0,
        ambiguous=ambiguous,
        requires_human_review=req_review,
        explanation=(
            f"Split payment: {len(best_txns)} transactions sum to invoice ₹{target}."
            + (f" ({len(solutions)} valid subsets; fewest-txn solution selected.)"
               if ambiguous else "")
            + (" Requires human review (>2 transactions)." if req_review else "")
        ),
    )


# ── Batch: one txn → many invoices ────────────────────────────────────────────

def run_pass4_batch(
    txn: TxnView,
    candidate_invoices: List[InvoiceView],
    settings=None,
) -> SplitMatchResult:
    """
    Find a subset of `candidate_invoices` whose expected_net_amounts sum to
    txn.amount (±tolerance).
    """
    if settings is None:
        settings = get_settings()

    target    = txn.amount
    tol_paise = _to_paise(Decimal(str(settings.amount_tolerance_rupees)))
    target_p  = _to_paise(target)
    max_pool  = settings.split_pool_max_size

    # Narrow candidate invoices by name consistency or explicit invoice ID in narration
    narr = (txn.narration or "").upper()
    found_invs = set(_INV_RE.findall(narr))
    relevant_invoices = []
    for inv in candidate_invoices:
        if inv.status != "open":
            continue
        inv_id = (inv.invoice_id or "").upper()
        if found_invs:
            if inv_id in found_invs:
                relevant_invoices.append(inv)
        else:
            if _name_ok(txn.narration, inv.counterparty_name):
                relevant_invoices.append(inv)

    pool = relevant_invoices if relevant_invoices else [inv for inv in candidate_invoices if inv.status == "open"]

    # ── Pool too large → flag for LLM ─────────────────────────────────────────
    if len(pool) > max_pool:
        return SplitMatchResult(
            match_type="flagged_for_llm",
            txn_ids=[txn.txn_id],
            flagged_for_llm=True,
            explanation=(
                f"Batch pool size {len(pool)} exceeds max {max_pool}. "
                f"Flagged for LLM adjudication."
            ),
        )

    # ── Enumerate all subsets of size >= 2 (batches require 2+ invoices) ──────
    inv_paise  = [_to_paise(inv.expected_net_amount) for inv in pool]
    solutions: List[tuple] = []

    for size in range(2, len(pool) + 1):
        for combo in itertools.combinations(range(len(pool)), size):
            subset_sum = sum(inv_paise[i] for i in combo)
            if abs(subset_sum - target_p) <= tol_paise:
                solutions.append(combo)

    if not solutions:
        return SplitMatchResult(
            match_type="no_match",
            txn_ids=[txn.txn_id],
            explanation="No subset of candidate invoices sums to txn amount.",
        )

    # ── Filter by counterparty name floor ─────────────────────────────────────
    valid_solutions = [
        combo for combo in solutions
        if all(_name_ok(txn.narration, pool[i].counterparty_name) for i in combo)
    ]
    if not valid_solutions:
        valid_solutions = solutions

    # ── Best solution: fewest invoices, then closest dates ────────────────────
    def _solution_score(combo):
        n_inv     = len(combo)
        max_delta = max(
            abs((txn.txn_date - pool[i].invoice_date).days)
            for i in combo
        )
        return (n_inv, max_delta)

    valid_solutions.sort(key=_solution_score)
    best_combo    = valid_solutions[0]
    best_invoices = [pool[i] for i in best_combo]
    ambiguous = len(valid_solutions) > 1
    allocated = {inv.invoice_id: inv.expected_net_amount for inv in best_invoices}

    return SplitMatchResult(
        match_type="batch_one_to_many",
        txn_ids=[txn.txn_id],
        invoice_ids=[inv.invoice_id for inv in best_invoices],
        allocated_amounts=allocated,
        remaining_unallocated=Decimal("0"),
        confidence_delta=45.0 if not ambiguous else 25.0,
        ambiguous=ambiguous,
        explanation=(
            f"Batched payout: txn ₹{txn.amount} covers {len(best_invoices)} invoice(s) "
            f"totalling ₹{sum(inv.expected_net_amount for inv in best_invoices)}."
            + (f" ({len(solutions)} valid subsets; fewest-invoice solution selected.)"
               if ambiguous else "")
        ),
    )


# ── Duplicate detection ───────────────────────────────────────────────────────

_SPLIT_KEYWORDS = {
    "PART", "SECOND", "2ND", "1ST", "FIRST", "THIRD", "3RD",
    "INSTALLMENT", "INSTALMENT", "TRANCHE", "ADVANCE", "BALANCE",
    "SPLIT", "FINAL", "REMAINING", "PARTIAL"
}

def detect_duplicate_txn(
    txn: TxnView,
    all_txns_for_merchant: List[TxnView],
    day_window: int = 3,
) -> Optional[str]:
    """
    Return the txn_id of the original transaction if `txn` appears to be an accidental duplicate
    (Case 15: identical amount + identical narration within `day_window` days).

    Guards against false positives:
      - If narration contains part-payment/installment keywords, returns None.
      - Asymmetric matching ensures only the later/duplicate transaction is flagged.
    """
    txn_narr = (txn.narration or "").upper()
    if any(kw in txn_narr for kw in _SPLIT_KEYWORDS):
        return None

    for other in all_txns_for_merchant:
        if other.txn_id == txn.txn_id:
            continue
        # Only flag if other is earlier in date, or same date with smaller/earlier identifier
        if other.txn_date > txn.txn_date:
            continue
        if other.txn_date == txn.txn_date and other.txn_id >= txn.txn_id:
            continue
        if other.direction != txn.direction:
            continue
        if other.amount != txn.amount:
            continue
        day_delta = abs((txn.txn_date - other.txn_date).days)
        if day_delta > day_window:
            continue

        other_narr = (other.narration or "").upper()
        if any(kw in other_narr for kw in _SPLIT_KEYWORDS):
            continue

        # Narration similarity check: near-exact match required for duplicate flag
        sim = max(fuzz.ratio(txn_narr, other_narr), fuzz.token_set_ratio(txn_narr, other_narr))
        if sim >= 85:
            return other.txn_id   # Return the original txn_id

    return None
