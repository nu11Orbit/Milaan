"""
models/merchant.py
Represents an Indian SME merchant who owns the bank account and invoices.
"""

from beanie import Document
from pydantic import Field
from typing import Optional


class Merchant(Document):
    merchant_id: str = Field(..., description="Unique merchant identifier")
    name: str = Field(..., description="Business / trade name")
    gstin: Optional[str] = Field(
        default=None,
        description="15-character GSTIN (format: 2-digit state code + 10-char PAN + entity code + checksum)",
    )
    state_code: str = Field(
        ...,
        description=(
            "2-digit Indian state code used to determine CGST+SGST (intrastate) "
            "vs IGST (interstate) — e.g. '27' for Maharashtra, '07' for Delhi"
        ),
    )
    bank_account_masked: Optional[str] = Field(
        default=None,
        description="Last 4 digits of the merchant's bank account, for display only",
    )

    class Settings:
        name = "merchants"
        indexes = [
            "merchant_id",
        ]
