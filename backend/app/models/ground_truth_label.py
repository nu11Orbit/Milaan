"""
models/ground_truth_label.py
Synthetic-data-only. Written by generate_synthetic_data.py BEFORE chaos injection,
so labels are always clean regardless of what the chaos pass does to the records.

Used exclusively by evaluation/metrics.py to compute precision/recall.
Would NOT exist in a production system.

Key design: txn_ids is a LIST — this natively supports split-settlement and
batched-payout ground truth without any schema gymnastics.
"""

from __future__ import annotations

from typing import List, Literal

from beanie import Document
from pymongo import IndexModel, ASCENDING
from pydantic import Field


# All 15 chaos case categories + "clean" (Section 5.4 of the build plan)
CaseCategory = Literal[
    "clean",
    "1",   # Exact 1:1 match
    "2",   # GST rounding drift ±₹1-2
    "3",   # TDS-adjusted settlement
    "4",   # Split settlement (many txns → 1 invoice)
    "5",   # Batched payout (1 txn → many invoices)
    "6",   # Partial payment (genuine open balance)
    "7",   # Partial refund (debit reversal)
    "8",   # Near-duplicate confusion (similar amount + name)
    "9",   # Reference number missing
    "10",  # Reference number truncated / malformed
    "11",  # Date lag outlier (45-60 days)
    "12",  # Orphan bank transaction (no invoice exists)
    "13",  # Genuine unpaid invoice (no txn exists)
    "14",  # Narration / counterparty name mismatch
    "15",  # Duplicate bank transaction (bank-side error)
]


class GroundTruthLabel(Document):
    # Invoice side — one invoice per label record
    invoice_id: str = Field(
        ...,
        description="Reference to Invoice.invoice_id. For case 12 (orphan txn), this will be a sentinel value.",
    )

    # Transaction side — LIST to support split and batched cases
    txn_ids: List[str] = Field(
        default_factory=list,
        description=(
            "All txn_ids that together settle this invoice. "
            "Empty list = case 13 (unpaid invoice — no txn expected). "
            "Multiple entries = case 4/5 (split or batched)."
        ),
    )

    is_true_match: bool = Field(
        ...,
        description=(
            "True if invoice_id + txn_ids form a valid reconciliation event. "
            "False for orphan txns (case 12) and unpaid invoices (case 13)."
        ),
    )

    case_category: CaseCategory = Field(
        ...,
        description="Injected chaos case tag — used for per-category precision/recall breakdown",
    )

    batch_id: str = Field(..., description="Batch this label belongs to")

    class Settings:
        name = "ground_truth_labels"
        indexes = [
            IndexModel([("invoice_id", ASCENDING)]),
            IndexModel([("batch_id", ASCENDING)]),
            IndexModel([("case_category", ASCENDING)]),  # fast per-category eval queries
        ]
