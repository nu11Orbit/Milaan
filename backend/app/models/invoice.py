"""
models/invoice.py
An invoice raised by or owed to the merchant.
Stores all Indian finance components: GST split, TDS section/rate/amount,
and the critical `expected_net_amount` that the matching engine targets.
"""

from __future__ import annotations

from decimal import Decimal
from datetime import date
from typing import Optional, Literal, Annotated

from beanie import Document
from pymongo import IndexModel, TEXT, ASCENDING, DESCENDING
from pydantic import Field, model_validator
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


# Valid Indian GST slabs — used for formula-consistency checks in the engine
GST_SLABS = {Decimal("0"), Decimal("5"), Decimal("12"), Decimal("18"), Decimal("28")}

# Known TDS sections for B2B services (build plan Section 3.2)
TDS_SECTIONS = Literal["194J", "194C", "194Q", "194I", "194H"]


class Invoice(Document):
    invoice_id: str = Field(..., description="Unique invoice identifier (e.g. INV-2024-0001)")
    merchant_id: str = Field(..., description="Owning merchant reference")
    batch_id: Optional[str] = Field(default=None, description="Batch upload ID — set by the upload router")

    # Counterparty details
    counterparty_name: str = Field(..., description="Customer / vendor business name (may be abbreviated in bank narration)")
    counterparty_gstin: Optional[str] = Field(default=None)
    counterparty_state_code: Optional[str] = Field(
        default=None,
        description="Used with merchant.state_code to determine intrastate vs interstate GST split",
    )

    # Dates
    invoice_date: date
    due_date: Optional[date] = None

    # ── Amount breakdown (all stored as Decimal128 in Mongo) ──────────────────
    base_amount: PyDecimal = Field(..., description="Pre-GST invoice amount in INR")

    # GST components — exactly one of (cgst+sgst) OR igst will be non-zero
    cgst_amount: PyDecimal = Field(default=Decimal("0"), description="Central GST (intrastate)")
    sgst_amount: PyDecimal = Field(default=Decimal("0"), description="State GST (intrastate)")
    igst_amount: PyDecimal = Field(default=Decimal("0"), description="Integrated GST (interstate)")

    total_amount: PyDecimal = Field(..., description="base + cgst + sgst + igst")

    # ── TDS (Tax Deducted at Source) ───────────────────────────────────────────
    tds_section: Optional[str] = Field(
        default=None,
        description="e.g. '194J' for professional services — see build plan Section 3.2",
    )
    tds_rate: Optional[PyDecimal] = Field(
        default=None,
        description="TDS rate as a decimal fraction (e.g. 0.10 for 10%)",
    )
    tds_amount: Optional[PyDecimal] = Field(
        default=None,
        description="Computed TDS deduction in INR",
    )

    # ── The key field the matching engine targets ──────────────────────────────
    expected_net_amount: PyDecimal = Field(
        ...,
        description=(
            "Amount the merchant should actually receive in bank: "
            "total_amount - tds_amount (if any). "
            "This is what gets compared against BankTransaction.amount."
        ),
    )

    reference_number: Optional[str] = Field(
        default=None,
        description="UTR / PO number / reference if the customer provided one on the invoice. Deliberately absent on ~15% of records.",
    )

    status: Literal["open", "settled", "partially_settled", "written_off"] = Field(
        default="open"
    )

    @model_validator(mode="after")
    def validate_gst_consistency(self) -> Invoice:
        """
        Warn if GST amounts don't correspond to a standard Indian slab.
        Does not raise — flags for the confidence scorer's formula_consistency check.
        """
        gst_total = self.cgst_amount + self.sgst_amount + self.igst_amount
        if self.base_amount > 0:
            effective_rate = (gst_total / self.base_amount * 100).quantize(Decimal("1"))
            if effective_rate not in GST_SLABS and gst_total != 0:
                # Store as a flag rather than raising — let the engine decide
                object.__setattr__(self, "_gst_slab_mismatch", True)
        return self

    class Settings:
        name = "invoices"
        indexes = [
            IndexModel([("merchant_id", ASCENDING), ("invoice_date", DESCENDING)]),
            IndexModel([("counterparty_name", TEXT)]),   # Atlas text search for Pass 2/3
            IndexModel([("status", ASCENDING)]),
            IndexModel([("reference_number", ASCENDING)]),  # UTR exact-match lookup
        ]
