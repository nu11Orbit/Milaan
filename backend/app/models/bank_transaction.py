"""
models/bank_transaction.py
A single entry from the merchant's bank statement.
Narration is deliberately raw / messy — the matching engine must cope.
"""

from __future__ import annotations

from decimal import Decimal
from datetime import date
from typing import Optional, Literal

from beanie import Document
from pymongo import IndexModel, TEXT, ASCENDING, DESCENDING
from pydantic import Field


class BankTransaction(Document):
    txn_id: str = Field(..., description="Unique transaction identifier")
    merchant_id: str = Field(..., description="Owning merchant reference")
    batch_id: Optional[str] = Field(default=None, description="Batch upload ID — set by the upload router")

    # Dates — value_date is the date funds actually clear (may differ from txn_date)
    txn_date: date = Field(..., description="Transaction posting date")
    value_date: Optional[date] = Field(
        default=None,
        description="Value / clearing date — may differ from txn_date by 1-2 days",
    )

    # Amount is always positive; direction carries the sign semantics
    amount: Decimal = Field(..., gt=Decimal("0"), description="Transaction amount in INR (always positive)")
    direction: Literal["credit", "debit"] = Field(
        ...,
        description="'credit' = money received into merchant account; 'debit' = money leaving",
    )

    # Payment channel — determines narration format (build plan Section 3.4)
    channel: Optional[Literal["UPI", "NEFT", "IMPS", "RTGS", "cheque", "other"]] = None

    # Raw narration string — deliberately messy, abbreviated, sometimes truncated
    narration: str = Field(
        ...,
        description=(
            "Raw bank narration string. Examples: "
            "'UPI/RAJESH TRADERS/402781234567/InvPymt', "
            "'NEFT-N123456789012-ACME PVT LTD'. "
            "Do NOT pre-clean — the matching engine handles noise."
        ),
    )

    # Extracted reference number — may be None if narration is unstructured
    reference_number: Optional[str] = Field(
        default=None,
        description=(
            "UTR / UPI reference extracted from narration where parseable. "
            "Deliberately None for ~15% of records (chaos case 9). "
            "Truncated/malformed for ~5% (chaos case 10)."
        ),
    )

    running_balance: Optional[Decimal] = Field(
        default=None,
        description="Account running balance after this transaction, if provided by the bank",
    )

    class Settings:
        name = "bank_transactions"
        indexes = [
            IndexModel([("merchant_id", ASCENDING), ("txn_date", DESCENDING)]),
            IndexModel([("narration", TEXT)]),              # Atlas text search for Pass 2/3
            IndexModel([("reference_number", ASCENDING)]),  # UTR exact-match in Pass 1
            IndexModel([("direction", ASCENDING)]),
        ]
