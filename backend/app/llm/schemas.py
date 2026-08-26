"""
llm/schemas.py
Shared Pydantic schemas for LLM adjudication I/O.

All providers return an AdjudicationResponse.
The adjudicator validates it; malformed → retry → fallback.
"""

from __future__ import annotations

from typing import List, Literal, Optional
from pydantic import BaseModel, Field, field_validator


class AdjudicationResponse(BaseModel):
    """
    Validated output from any LLM provider.

    assessment        : LLM's qualitative judgment.
    confidence_delta  : How much to adjust the engine's score (-20 to +20).
                        The engine CLAMPS this server-side — model cannot exceed ±20.
    explanation       : Human-readable reason (stored in Match.explanation_text).
    key_factors       : Short bullet points surfaced in the UI audit trail.
    """
    assessment: Literal["match", "no_match", "insufficient_evidence"]
    confidence_delta: float = Field(ge=-20.0, le=20.0)
    explanation: str = Field(max_length=280)
    key_factors: List[str] = Field(default_factory=list, max_length=5)

    # ── Server-side clamp guard (belt-and-suspenders after Field validation) ──
    @field_validator("confidence_delta", mode="before")
    @classmethod
    def clamp_delta(cls, v: float) -> float:
        return max(-20.0, min(20.0, float(v)))

    @field_validator("explanation", mode="before")
    @classmethod
    def truncate_explanation(cls, v: str) -> str:
        return str(v)[:280]

    # ── Assessment → delta mapping for insufficient_evidence ─────────────────
    def effective_delta(self) -> float:
        """
        'insufficient_evidence' must NOT push the score into auto_accept.
        We return 0 so the engine's pre-LLM score is unchanged.
        The band stays as-is (review or reject).
        """
        if self.assessment == "insufficient_evidence":
            return 0.0
        return self.confidence_delta

    @classmethod
    def fallback_no_llm(cls, reason: str = "Both LLM providers exhausted") -> "AdjudicationResponse":
        """
        Factory for the safe fallback when both Gemini and Groq are down.
        Returns assessment=insufficient_evidence so the record lands in review
        (never auto-accepted or auto-rejected due to LLM failure).
        """
        return cls(
            assessment="insufficient_evidence",
            confidence_delta=0.0,
            explanation=f"LLM unavailable: {reason[:200]}. Record sent to review queue.",
            key_factors=["LLM providers unavailable — human review required"],
        )
