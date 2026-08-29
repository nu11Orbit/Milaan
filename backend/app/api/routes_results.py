"""
api/routes_results.py
Fetch reconciliation results for a completed batch.

Endpoints:
  GET /api/batches/{id}/matches    — all matches with confidence bands
  GET /api/batches/{id}/exceptions — unresolved records with reason codes
  GET /api/batches/{id}/metrics    — precision/recall + case-category breakdown
  GET /api/batches/{id}/evaluate   — full evaluation against ground truth
  GET/POST /api/config/thresholds  — live threshold read/write
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.core.config import get_settings
from app.models.match import Match

log = logging.getLogger(__name__)
router = APIRouter()


# ── Match list ────────────────────────────────────────────────────────────────

@router.get("/batches/{batch_id}/matches")
async def list_matches(
    batch_id:  str,
    run_id:    Optional[str] = None,
    band:      Optional[str] = None,   # filter: auto_accept | review | reject
    limit:     int = 100,
    skip:      int = 0,
):
    """
    List all Match records for a batch, optionally filtered by confidence band.
    """
    query = Match.find(Match.batch_id == batch_id)
    if run_id:
        query = Match.find(Match.batch_id == batch_id, Match.run_id == run_id)
    if band:
        query = query.find(Match.confidence_band == band)

    matches = await query.skip(skip).limit(limit).to_list()

    return {
        "batch_id":  batch_id,
        "count":     len(matches),
        "matches": [
            {
                "match_id":        m.match_id,
                "match_type":      m.match_type,
                "confidence_score": m.confidence_score,
                "confidence_band": m.confidence_band,
                "explanation_text": m.explanation_text,
                "explanation_source": m.explanation_source,
                "line_items": [
                    {
                        "txn_id":          li.txn_id,
                        "invoice_id":      li.invoice_id,
                        "allocated_amount": str(li.allocated_amount),
                    }
                    for li in m.line_items
                ],
                "created_at": m.created_at.isoformat(),
                "reviewed_by":  m.reviewed_by,
                "review_action": m.review_action,
            }
            for m in matches
        ],
    }


# ── Exception list ─────────────────────────────────────────────────────────────

@router.get("/batches/{batch_id}/exceptions")
async def list_exceptions(batch_id: str, run_id: Optional[str] = None):
    """
    List all reject-band records. Every record has exception_reason_category set.
    This is the 'honest exception list' required by the track spec.
    """
    query_args = [Match.batch_id == batch_id, Match.confidence_band == "reject"]
    if run_id:
        query_args.append(Match.run_id == run_id)

    exceptions = await Match.find(*query_args).to_list()

    return {
        "batch_id":   batch_id,
        "count":      len(exceptions),
        "exceptions": [
            {
                "match_id":                   m.match_id,
                "exception_reason_category":  m.exception_reason_category,
                "exception_reason_detail":    m.exception_reason_detail,
                "line_items": [
                    {"txn_id": li.txn_id, "invoice_id": li.invoice_id}
                    for li in m.line_items
                ],
                "created_at": m.created_at.isoformat(),
            }
            for m in exceptions
        ],
    }


# ── Metrics ───────────────────────────────────────────────────────────────────

@router.get("/batches/{batch_id}/metrics")
async def get_metrics(batch_id: str, run_id: Optional[str] = None):
    """
    Throughput and confidence distribution metrics for a batch run.
    Full precision/recall (requires ground truth) is computed by the
    evaluation module and available after running the evaluation endpoint.
    """
    query_args = [Match.batch_id == batch_id]
    if run_id:
        query_args.append(Match.run_id == run_id)

    matches = await Match.find(*query_args).to_list()
    total = len(matches)
    if total == 0:
        raise HTTPException(404, f"No matches found for batch '{batch_id}'")

    by_band: Dict[str, int] = {"auto_accept": 0, "review": 0, "reject": 0}
    by_type: Dict[str, int] = {}
    by_source: Dict[str, int] = {}
    score_sum = 0.0

    for m in matches:
        by_band[m.confidence_band] = by_band.get(m.confidence_band, 0) + 1
        by_type[m.match_type]      = by_type.get(m.match_type, 0) + 1
        if m.explanation_source:
            by_source[m.explanation_source] = by_source.get(m.explanation_source, 0) + 1
        score_sum += m.confidence_score

    settings = get_settings()
    pending_count = sum(1 for m in matches if getattr(m, "pending_llm_enrichment", False))

    return {
        "batch_id": batch_id,
        "total":    total,
        "by_confidence_band": by_band,
        "by_match_type":      by_type,
        "by_explanation_source": by_source,
        "avg_confidence_score": round(score_sum / total, 2),
        "auto_accept_rate": round(by_band["auto_accept"] / total * 100, 1),
        "exception_rate":   round(by_band["reject"] / total * 100, 1),
        "pending_llm_enrichment_count": pending_count,
        "pending_llm_enrichment_message": (
            f"{pending_count} records showing deterministic score only — "
            "LLM narrative pending quota reset. Use POST /api/batches/{id}/retry-llm to enrich."
            if pending_count else None
        ),
        "thresholds_used": {
            "auto_accept": settings.threshold_auto_accept,
            "review":      settings.threshold_review,
        },
    }


# ── Evaluation (precision / recall against ground truth) ──────────────────────

@router.get("/batches/{batch_id}/evaluate")
async def evaluate_batch(batch_id: str, run_id: Optional[str] = None):
    """
    Compute full precision/recall/F1 against GroundTruthLabel records.

    Requires the synthetic data generator to have been run first (it writes
    GroundTruthLabel documents with batch_id set).

    Returns:
    - Overall precision/recall/F1 (auto_accept band only for precision)
    - False-positive ₹ cost (sum of wrongly auto-accepted amounts)
    - Per case-category breakdown (Cases 1–15)
    - Exception completeness (must be 100%)
    - Success criteria pass/fail flags
    """
    from app.evaluation.metrics import compute_metrics, metrics_to_dict
    result = await compute_metrics(batch_id, run_id)
    return metrics_to_dict(result)


# ── Calibration & Reliability Diagram (Isotonic Regression) ───────────────────

@router.get("/batches/{batch_id}/calibration")
async def get_batch_calibration(batch_id: str, run_id: Optional[str] = None):
    """
    Compute confidence score calibration curve, Brier score, and Expected Calibration Error (ECE)
    using Isotonic Regression against GroundTruthLabel data.
    """
    from app.evaluation.calibration import calibrate_batch
    return await calibrate_batch(batch_id, run_id)


# ── Live threshold config ──────────────────────────────────────────────────────

class ThresholdUpdate(BaseModel):
    threshold_auto_accept: Optional[float] = None
    threshold_review:      Optional[float] = None


@router.get("/config/thresholds")
async def get_thresholds():
    """Get current confidence band thresholds."""
    s = get_settings()
    return {
        "threshold_auto_accept": s.threshold_auto_accept,
        "threshold_review":      s.threshold_review,
        "note": (
            "Set THRESHOLD_AUTO_ACCEPT and THRESHOLD_REVIEW in .env to persist. "
            "POST to this endpoint for in-process demo adjustment (resets on restart)."
        ),
    }


@router.post("/config/thresholds")
async def update_thresholds(body: ThresholdUpdate):
    """
    Update thresholds in-process (for live demo slider — resets on restart).
    Persisting across restarts requires updating .env.
    """
    from functools import lru_cache
    from app.core import config as cfg_module

    s = get_settings()
    if body.threshold_auto_accept is not None:
        s.__dict__["threshold_auto_accept"] = body.threshold_auto_accept
    if body.threshold_review is not None:
        s.__dict__["threshold_review"] = body.threshold_review

    return {
        "updated": True,
        "threshold_auto_accept": s.threshold_auto_accept,
        "threshold_review":      s.threshold_review,
    }
