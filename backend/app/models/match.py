"""
models/match.py
A reconciliation match — the core output of the engine.

Key design decisions:
- MatchLineItem is an EMBEDDED sub-document (not a separate collection).
  This avoids a join table and makes atomic reads of a full match trivial.
- line_items supports 1:1, many-to-one (split), and one-to-many (batch) natively.
- threshold_snapshot stores the thresholds IN EFFECT at run time so historical
  matches remain interpretable even after you tune thresholds later.
"""

from __future__ import annotations

from decimal import Decimal
from datetime import datetime
from typing import Optional, Literal, List, Annotated

from beanie import Document
from pymongo import IndexModel, ASCENDING, DESCENDING
from pydantic import BaseModel, Field
from pydantic.functional_validators import BeforeValidator


def _coerce_decimal(v: object) -> object:
    """Convert BSON Decimal128 to a plain Decimal before Pydantic validation."""
    try:
        from bson import Decimal128
        if isinstance(v, Decimal128):
            return Decimal(str(v))
    except ImportError:
        pass
    return v


PyDecimal = Annotated[Decimal, BeforeValidator(_coerce_decimal)]


class MatchLineItem(BaseModel):
    """
    Embedded sub-document: one invoice-transaction allocation within a match.
    For a 1:1 match there will be exactly one line item.
    For a split (many txns → 1 invoice) there will be multiple, one per txn.
    For a batch (many invoices → 1 txn) there will be multiple, one per invoice.
    """

    invoice_id: Optional[str] = Field(
        default=None,
        description="Reference to Invoice.invoice_id — null for orphan txn exceptions",
    )
    txn_id: Optional[str] = Field(
        default=None,
        description="Reference to BankTransaction.txn_id — null for unpaid invoice exceptions",
    )
    allocated_amount: PyDecimal = Field(
        ...,
        description=(
            "How much of this txn/invoice is consumed by this match. "
            "For full 1:1 this equals the full amount. "
            "For partial/split cases it may be less than the total — "
            "remaining_unallocated_amount is tracked by the orchestrator."
        ),
    )


class Match(Document):
    match_id: str = Field(..., description="Unique match identifier (e.g. MATCH-uuid4)")
    batch_id: str = Field(..., description="Batch this match belongs to")
    run_id: str = Field(..., description="Specific reconciliation run (idempotency key)")

    match_type: Literal[
        "one_to_one",
        "split_many_to_one",    # multiple txns → one invoice
        "batch_one_to_many",    # one txn → multiple invoices
        "partial",              # genuine partial payment / open balance
        "exception",            # unmatched — no candidate found
    ]

    confidence_score: float = Field(..., ge=0, le=100)
    confidence_band: Literal["auto_accept", "review", "reject"]

    explanation_text: Optional[str] = Field(
        default=None,
        description="Human-readable explanation of the match decision (≤280 chars for LLM-generated ones)",
    )
    explanation_source: Optional[Literal["rules_engine", "fuzzy", "embedding", "llm", "none"]] = None

    # All invoice + txn allocations for this match (embedded — no join needed)
    line_items: List[MatchLineItem] = Field(default_factory=list)

    # Snapshot of thresholds at run time — never use live config to interpret old matches
    threshold_snapshot: dict = Field(
        default_factory=dict,
        description="{'auto_accept': 85.0, 'review': 50.0} as configured when this run fired",
    )

    # Exception details — only populated when confidence_band == 'reject' / no candidate
    exception_reason_category: Optional[str] = Field(
        default=None,
        description=(
            "Structured reason code for exceptions — e.g. 'no_candidate_found', "
            "'partial_payment_open', 'orphan_bank_credit', 'duplicate_detected'. "
            "100% of reject-band records must have a non-null value here."
        ),
    )
    exception_reason_detail: Optional[str] = Field(
        default=None,
        description="Human-readable elaboration of the exception reason",
    )

    # ── Pending LLM enrichment ────────────────────────────────────────────────
    # Set to True when Pass 5 was skipped because BOTH providers were
    # rate-limited / quota-exceeded (not because evidence was insufficient).
    # This is NOT a confidence band — a record can be 'review' band AND
    # pending_llm_enrichment at the same time.
    # Cleared to False when the retry worker successfully runs Pass 5.
    pending_llm_enrichment: bool = Field(
        default=False,
        description=(
            "True when Pass 5 was skipped due to provider rate-limiting. "
            "Pass 1-4 scores are final; only the LLM narrative + delta is missing. "
            "Cleared automatically when the retry worker completes Pass 5."
        ),
    )
    pending_llm_reason: Optional[str] = Field(
        default=None,
        description="Human-readable reason the LLM pass was deferred (e.g. provider error message)",
    )

    # Timestamps + human review
    created_at: datetime = Field(default_factory=datetime.utcnow)
    reviewed_by: Optional[str] = Field(default=None, description="User ID of human reviewer")
    reviewed_at: Optional[datetime] = None
    review_action: Optional[Literal["accepted", "rejected"]] = Field(
        default=None,
        description="Human decision on a review-band match",
    )

    class Settings:
        name = "matches"
        indexes = [
            IndexModel([("batch_id", ASCENDING), ("run_id", ASCENDING)]),
            IndexModel([("confidence_band", ASCENDING)]),
            IndexModel([("created_at", DESCENDING)]),
            # Compound index for fast exception listing
            IndexModel([("batch_id", ASCENDING), ("confidence_band", ASCENDING)]),
            # Index for the LLM retry worker — find all pending records efficiently
            IndexModel([("pending_llm_enrichment", ASCENDING), ("batch_id", ASCENDING)]),
        ]
