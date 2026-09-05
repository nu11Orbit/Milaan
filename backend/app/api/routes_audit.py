"""
api/routes_audit.py
Audit trail retrieval + human review action.

Endpoints:
  GET  /api/matches/{match_id}/audit   — full audit trail for one match
  POST /api/matches/{match_id}/review  — human accept/reject on a review-band match
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Literal, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.models.audit_log_entry import AuditLogEntry
from app.models.match import Match

log = logging.getLogger(__name__)
router = APIRouter()


# ── Audit trail ────────────────────────────────────────────────────────────────

@router.get("/matches/{match_id}/audit")
async def get_audit_trail(match_id: str):
    """
    Return the full step-by-step audit trail for one match.

    Each entry shows:
    - Which pass wrote it
    - Score delta it contributed
    - Human-readable reasoning
    - Raw LLM response (if pass5_llm ran — key demo artifact)
    - Which provider served the LLM call

    This endpoint is the 'every decision reconstructable' deliverable for the track.
    """
    match = await Match.find_one(Match.match_id == match_id)
    if not match:
        raise HTTPException(404, f"Match '{match_id}' not found")

    entries = await AuditLogEntry.find(
        AuditLogEntry.match_id == match_id
    ).sort("+timestamp").to_list()

    return {
        "match_id":         match.match_id,
        "match_type":       match.match_type,
        "confidence_score": match.confidence_score,
        "confidence_band":  match.confidence_band,
        "explanation_text": match.explanation_text,
        "threshold_snapshot": match.threshold_snapshot,
        "reviewed_by":      match.reviewed_by,
        "review_action":    match.review_action,
        "audit_trail": [
            {
                "log_id":         e.log_id,
                "pass_name":      e.pass_name,
                "score_delta":    e.score_delta,
                "score_after":    e.score_after,
                "reasoning_text": e.reasoning_text,
                # LLM-specific fields — null for non-LLM passes
                "raw_llm_response": e.raw_llm_response,
                "llm_provider":     e.llm_provider,
                "llm_model":        e.llm_model,
                "llm_fallback_used": e.llm_fallback_used,
                "llm_both_failed":   e.llm_both_failed,
                "timestamp": e.timestamp.isoformat(),
            }
            for e in entries
        ],
    }


# ── Human review action ────────────────────────────────────────────────────────

class ReviewAction(BaseModel):
    action:      Literal["accepted", "rejected"]
    reviewer_id: str
    note:        Optional[str] = None


@router.post("/matches/{match_id}/review")
async def submit_review(match_id: str, body: ReviewAction):
    """
    Submit a human review decision on a review-band match.

    Only review-band matches can be acted on.
    Auto-accept matches are already confirmed; reject-band are exceptions.

    Records reviewer_id + timestamp for the full audit trail.
    """
    match = await Match.find_one(Match.match_id == match_id)
    if not match:
        raise HTTPException(404, f"Match '{match_id}' not found")

    if match.confidence_band not in ("review", "reject"):
        raise HTTPException(
            400,
            f"Match is in '{match.confidence_band}' band — auto-accept matches are already confirmed. "
            f"Only 'review' and 'reject' band matches can be adjudicated by a controller.",
        )

    if match.review_action is not None:
        raise HTTPException(
            409,
            f"Match already reviewed: action='{match.review_action}' by '{match.reviewed_by}' at {match.reviewed_at}",
        )

    match.review_action = body.action
    match.reviewed_by   = body.reviewer_id
    match.reviewed_at   = datetime.utcnow()
    await match.save()

    # Write audit entry for the human review
    entry = AuditLogEntry(
        log_id=f"LOG-{match_id[-8:]}-review",
        match_id=match_id,
        batch_id=match.batch_id,
        pass_name="human_review",
        reasoning_text=(
            f"Human review: {body.action.upper()} by {body.reviewer_id}"
            + (f" — {body.note}" if body.note else "")
        ),
    )
    await entry.insert()

    log.info(f"Match {match_id} reviewed: {body.action} by {body.reviewer_id}")

    return {
        "match_id":     match_id,
        "review_action": match.review_action,
        "reviewed_by":   match.reviewed_by,
        "reviewed_at":   match.reviewed_at.isoformat(),
    }
