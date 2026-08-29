"""
engine/confidence_scorer.py
Confidence Scorer + Decision Router
======================================

Takes a CandidateMatch (with all pass contributions already recorded)
and collapses the running score into:

  • final_score   (float, 0–100, clamped)
  • band          ("auto_accept" | "review" | "reject")
  • decision      (same as band, but may be overridden to "review" by safety gates)
  • threshold_snapshot  (dict — stored on Match at run time so historical records
                         reflect the thresholds that were ACTIVE when the decision
                         was made, not today's values)

Scoring formula
───────────────
The raw running score already encodes per-signal contributions from all 5 passes.
The LLM adjudicator (Pass 5) returns a `confidence_delta` in [-20, +20] that is
clamped server-side and added here.

Fellegi-Sunter blend (optional)
────────────────────────────────
When a Fellegi-Sunter score is supplied (via `fs_score` parameter), the final
score is a weighted blend:

  final_score = 0.6 × heuristic_score + 0.4 × fs_score + llm_delta

The 60/40 ratio is conservative — it preserves the existing heuristic signal
whilst meaningfully incorporating the theoretically grounded FS estimate.
As labeled data accumulates and FS m/u probabilities sharpen, the FS weight
can be increased toward 1.0 in production.

Without fs_score (fs_score=None), behaviour is identical to the original:

  final_score = heuristic_score + llm_delta

Decision bands (configurable via config, NEVER hardcoded):
  final_score ≥ threshold_auto_accept  → band = "auto_accept"
  final_score ≥ threshold_review       → band = "review"
  final_score <  threshold_review      → band = "reject" (→ exception queue)

Safety gate overrides (always applied AFTER band calculation):
  • requires_human_review=True  → forced to "review" even if score ≥ auto_accept
  • flagged_for_llm=True        → forced to "review" if LLM hasn't adjudicated yet
  • is_exception=True           → forced to "reject" regardless of score
  • score < 30                  → forced to "reject" (hard floor, not configurable)
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Optional, Dict

from app.engine.schemas import CandidateMatch
from app.core.config import get_settings

# ── Hard floor — below this we never auto-accept regardless of config ─────────
HARD_FLOOR_REJECT = 30.0


@dataclass
class ConfidenceResult:
    """Output of the confidence scorer."""
    invoice_id: str
    txn_id:     str          # Primary txn (may be one of many for split/batch)

    # Scores
    pass_score:  float       # Sum of all pass contributions (pre-LLM)
    llm_delta:   float       # LLM adjustment applied (0.0 if LLM not invoked)
    final_score: float       # Clamped to [0, 100]

    # Decision
    band: Literal["auto_accept", "review", "reject"]
    decision: Literal["auto_accept", "review", "reject"]   # may differ from band due to gates

    # Why the decision was made (natural-language, ≤280 chars)
    explanation: str

    # Gate flags applied
    gate_human_review: bool = False
    gate_exception:    bool = False
    gate_hard_floor:   bool = False
    gate_flagged_llm:  bool = False

    # Threshold snapshot — stored verbatim on Match.threshold_snapshot
    threshold_snapshot: Dict[str, float] = None   # type: ignore

    def __post_init__(self):
        if self.threshold_snapshot is None:
            self.threshold_snapshot = {}


def score(
    candidate: CandidateMatch,
    llm_delta:  float = 0.0,
    fs_score:   Optional[float] = None,
    requires_human_review: bool = False,
    flagged_for_llm: bool = False,
    settings=None,
) -> ConfidenceResult:
    """
    Compute the final confidence score and decision for a candidate match.

    Parameters
    ----------
    candidate            : CandidateMatch with all pass contributions populated.
    llm_delta            : Adjustment from Pass 5 LLM adjudication (-20 to +20).
                           Clamped to [-20, +20] here regardless of what the model returned.
    fs_score             : Fellegi-Sunter score in [0, 100] (optional).
                           When provided, blended at 60% heuristic / 40% FS.
                           When None, behaviour is identical to the original formula.
    requires_human_review: True for split matches with >2 txns (Pass 4 gate).
    flagged_for_llm      : True when Pass 4 couldn't resolve due to pool size / name floor.
    settings             : Injected settings (optional).

    Returns
    -------
    ConfidenceResult with final score, band, decision, and threshold_snapshot.
    """
    if settings is None:
        settings = get_settings()

    # Clamp LLM delta server-side (model cannot exceed ±20 regardless of output)
    llm_delta_clamped = max(-20.0, min(20.0, llm_delta))

    pass_score = candidate.score

    # ── Fellegi-Sunter blend (when fs_score provided) ───────────────────────
    # Conservative 60/40 blend: majority weight stays on heuristic passes (which
    # are well-tested) while FS contributes a theoretically grounded pull.
    # When fs_score is None (legacy path), no change in behaviour.
    if fs_score is not None:
        blended_score = 0.6 * pass_score + 0.4 * fs_score
    else:
        blended_score = pass_score

    final_score = max(0.0, min(100.0, blended_score + llm_delta_clamped))

    auto_thr  = settings.threshold_auto_accept
    rev_thr   = settings.threshold_review

    # ── Band determination ──────────────────────────────────────────────────────
    if final_score >= auto_thr:
        band = "auto_accept"
    elif final_score >= rev_thr:
        band = "review"
    else:
        band = "reject"

    # ── Safety gate overrides ──────────────────────────────────────────────────
    decision = band
    gate_human_review = False
    gate_exception    = False
    gate_hard_floor   = False
    gate_flagged_llm  = False

    if candidate.is_exception:
        decision    = "reject"
        gate_exception = True
    elif final_score < HARD_FLOOR_REJECT:
        decision    = "reject"
        gate_hard_floor = True
    elif requires_human_review and decision == "auto_accept":
        decision    = "review"
        gate_human_review = True
    elif flagged_for_llm and decision == "auto_accept":
        decision    = "review"
        gate_flagged_llm = True

    # ── Explanation text ───────────────────────────────────────────────────────
    explanation = candidate.explanation_text()
    if not explanation:
        explanation = f"Score {final_score:.1f} → {decision}"
    # Append gate notes
    if gate_human_review:
        explanation += " [Review gate: >2 txn split requires human approval]"
    if gate_flagged_llm:
        explanation += " [Review gate: LLM flagged for adjudication]"
    if gate_hard_floor:
        explanation += f" [Reject gate: score {final_score:.1f} < hard floor {HARD_FLOOR_REJECT}]"
    if gate_exception:
        explanation += f" [Exception: {candidate.exception_reason_category}]"
    explanation = explanation[:280]

    # ── Threshold snapshot ──────────────────────────────────────────────────────
    snapshot = {
        "threshold_auto_accept": settings.threshold_auto_accept,
        "threshold_review":      settings.threshold_review,
        "hard_floor_reject":     HARD_FLOOR_REJECT,
        "amount_tolerance_rupees":     settings.amount_tolerance_rupees,
        "candidate_date_window_days":  settings.candidate_date_window_days,
        "embedding_similarity_floor":  settings.embedding_similarity_floor,
        "split_pool_max_size":         float(settings.split_pool_max_size),
        # FS metadata — None when FS was not applied
        "fs_score":   round(fs_score, 2) if fs_score is not None else None,
        "fs_blend":   "0.6 × heuristic + 0.4 × fs" if fs_score is not None else "heuristic only",
    }

    return ConfidenceResult(
        invoice_id=candidate.invoice_id,
        txn_id=candidate.txn_id,
        pass_score=round(pass_score, 2),
        llm_delta=llm_delta_clamped,
        final_score=round(final_score, 2),
        band=band,
        decision=decision,
        explanation=explanation,
        gate_human_review=gate_human_review,
        gate_exception=gate_exception,
        gate_hard_floor=gate_hard_floor,
        gate_flagged_llm=gate_flagged_llm,
        threshold_snapshot=snapshot,
    )


def near_duplicate_check(
    top_candidate_score:    float,
    second_candidate_score: float,
    gap_floor: float = 15.0,
) -> bool:
    """
    Return True if the top two candidates are suspiciously close (Case 8).

    When the top two candidates are within `gap_floor` points of each other,
    the engine cannot confidently distinguish them — the match should be
    escalated to review rather than auto-accepted, even if the top score is
    above the auto_accept threshold.

    Called by the orchestrator before invoking score().
    """
    return (top_candidate_score - second_candidate_score) < gap_floor
