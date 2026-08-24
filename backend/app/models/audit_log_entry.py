"""
models/audit_log_entry.py
One entry per matching pass that ran for a given match.

Every match gets at least one audit log entry (the pass that resolved it).
If Pass 5 (LLM) ran, a second entry captures the raw LLM response and which
provider served the call — Gemini or Groq.

This is the concrete deliverable for the 'full audit trail' requirement and
the 'every decision reconstructable' bar stated in build plan Section 13.
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional, Literal

from beanie import Document
from pymongo import IndexModel, ASCENDING, DESCENDING
from pydantic import Field


class AuditLogEntry(Document):
    log_id: str = Field(..., description="Unique log entry ID (uuid4)")
    match_id: str = Field(..., description="Reference to Match.match_id")
    batch_id: str = Field(..., description="Batch reference — for fast batch-level audit queries")

    # Which pass wrote this entry
    pass_name: Literal[
        "pass1_rules",
        "pass2_fuzzy",
        "pass3_embedding",
        "pass4_split_matcher",
        "pass5_llm",
        "confidence_scorer",
        "decision_router",
        "human_review",
    ]

    # Score contribution from this pass
    score_delta: Optional[float] = Field(
        default=None,
        description=(
            "How much this pass changed the confidence score. "
            "Null for passes that don't directly produce a score delta (e.g. human_review)."
        ),
    )
    score_after: Optional[float] = Field(
        default=None,
        description="Confidence score after this pass applied its contribution",
    )

    # Human-readable reasoning (deterministic passes write their own; LLM pass writes explanation from model)
    reasoning_text: Optional[str] = Field(
        default=None,
        description="What this pass found and why it contributed this delta",
    )

    # LLM-specific fields — only populated when pass_name == 'pass5_llm'
    raw_llm_response: Optional[str] = Field(
        default=None,
        description=(
            "Full raw JSON string returned by the LLM — stored verbatim for traceability. "
            "A screenshot of this in the audit trail UI is a key demo artifact."
        ),
    )
    llm_provider: Optional[Literal["gemini", "groq"]] = Field(
        default=None,
        description="Which LLM provider actually served this call (Gemini primary, Groq fallback)",
    )
    llm_model: Optional[str] = Field(
        default=None,
        description="Exact model string used (e.g. 'gemini-2.5-flash-lite')",
    )
    llm_fallback_used: bool = Field(
        default=False,
        description="True if Gemini was skipped and Groq served this call",
    )
    llm_both_failed: bool = Field(
        default=False,
        description="True if both providers were unavailable — deterministic scores used alone",
    )

    timestamp: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "audit_log"
        indexes = [
            IndexModel([("match_id", ASCENDING)]),                          # fetch all entries for one match
            IndexModel([("batch_id", ASCENDING), ("timestamp", DESCENDING)]),  # batch-level audit view
            IndexModel([("pass_name", ASCENDING)]),
        ]
