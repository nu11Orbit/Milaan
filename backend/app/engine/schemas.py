"""
engine/schemas.py
Shared data classes for the 5-pass matching pipeline.

All passes read and write these structures — no pass imports from another pass.
The orchestrator assembles the pipeline.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from typing import Optional, Literal, List
from datetime import date


# ── Score contribution from a single rule / pass ───────────────────────────────

@dataclass
class ScoreContribution:
    """One signal's contribution to the overall confidence score."""
    source: str                     # e.g. "pass1_utr_exact", "pass2_fuzzy_name"
    delta: float                    # points added (positive) or subtracted (negative)
    reason: str                     # human-readable explanation
    rule_fired: bool = True         # False = rule was checked but did not fire


# ── Full candidate match record (flows through all 5 passes) ──────────────────

@dataclass
class CandidateMatch:
    """
    A candidate (invoice_id, txn_id) pair being evaluated.
    Each pass reads the current score and appends its own ScoreContributions.
    The confidence scorer collapses contributions → final score + band.
    """
    # References
    invoice_id: str
    txn_id: str

    # Running score — updated by each pass
    score: float = 0.0

    # Per-pass contributions (ordered — useful for audit trail rendering)
    contributions: List[ScoreContribution] = field(default_factory=list)

    # The last pass that resolved this candidate (set when score clears a band)
    resolved_by: Optional[Literal[
        "pass1_rules", "pass2_fuzzy", "pass3_embedding",
        "pass4_split_matcher", "pass5_llm", "exception"
    ]] = None

    # Exception flag — set when NO candidate was found for a txn/invoice
    is_exception: bool = False
    exception_reason_category: Optional[str] = None
    exception_reason_detail: Optional[str] = None

    # Match type — determined by the orchestrator
    match_type: Optional[Literal[
        "one_to_one", "split_many_to_one",
        "batch_one_to_many", "partial", "exception"
    ]] = None

    def add(self, source: str, delta: float, reason: str, fired: bool = True) -> None:
        self.contributions.append(
            ScoreContribution(source=source, delta=delta, reason=reason, rule_fired=fired)
        )
        if fired:
            self.score = min(100.0, max(0.0, self.score + delta))

    def explanation_text(self, max_chars: int = 280) -> str:
        """Collapse all fired contributions into a single human-readable string."""
        parts = [c.reason for c in self.contributions if c.rule_fired]
        text = ". ".join(parts)
        return text[:max_chars]


# ── A minimal view of an invoice used by the engine (avoids Beanie dependency) ─

@dataclass
class InvoiceView:
    invoice_id: str
    merchant_id: str
    counterparty_name: str
    invoice_date: date
    base_amount: Decimal
    total_amount: Decimal
    expected_net_amount: Decimal
    tds_amount: Optional[Decimal]
    tds_section: Optional[str]
    cgst_amount: Decimal
    sgst_amount: Decimal
    igst_amount: Decimal
    reference_number: Optional[str]
    status: str


@dataclass
class TxnView:
    txn_id: str
    merchant_id: str
    txn_date: date
    amount: Decimal
    direction: str
    channel: Optional[str]
    narration: str
    reference_number: Optional[str]
