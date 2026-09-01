"""
engine/hungarian_matcher.py
Globally Optimal Bipartite Matching via the Hungarian Algorithm
================================================================

Replaces greedy first-come-first-served invoice claiming with globally
optimal bipartite assignment using Kuhn-Munkres (Hungarian algorithm)
via scipy.optimize.linear_sum_assignment in O(n³).

Theory
------
In a batch of N transactions and M invoices with candidate compatibility scores
S[i, j] ∈ [0, 100], greedy sequential assignment claims invoices in arrival/amount
order. A sub-optimal early claim (e.g. Txn 1 claiming Invoice A with score 82)
can lock out a higher-confidence match (e.g. Txn 2 which has score 98 for Invoice A
and no other candidate).

The Hungarian algorithm finds the global assignment matrix X ∈ {0, 1}^{N × M}
that maximizes the total batch confidence:
    maximize   Σ_{i, j} S[i, j] * X[i, j]
    subject to Σ_j X[i, j] ≤ 1  ∀ i  (each transaction matches at most 1 invoice)
               Σ_i X[i, j] ≤ 1  ∀ j  (each invoice matches at most 1 transaction)

Implementation
--------------
We formulate this as a minimum-cost bipartite matching by defining:
    cost[i, j] = 100.0 - S[i, j]   for valid candidate pairs (S ≥ min_score)
    cost[i, j] = 1000.0            for non-candidate / forbidden pairs

We augment the matrix with N slack (dummy) columns with cost = 100.0, allowing
any transaction to remain unassigned if no profitable match exists.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Dict, List, Optional, Set, Tuple

import numpy as np
from scipy.optimize import linear_sum_assignment

from app.core.config import get_settings
from app.models.match import MatchLineItem

log = logging.getLogger(__name__)

# Minimum score to consider an assignment viable (below this, dummy/unmatched is preferred)
MIN_VIABLE_SCORE = 30.0
# Cost assigned to dummy unassigned column (equivalent to score = 0)
UNMATCHED_COST = 100.0
# Penalty cost for non-candidate pairs
FORBIDDEN_PAIR_COST = 1000.0


@dataclass
class AssignmentResult:
    """Outcome of Hungarian bipartite assignment for a single transaction."""
    txn_id: str
    assigned_invoice_id: Optional[str]
    score: float
    is_reassigned: bool = False
    original_greedy_invoice_id: Optional[str] = None
    reassignment_reason: Optional[str] = None


def solve_optimal_assignment(
    txn_ids: List[str],
    invoice_ids: List[str],
    candidate_scores: Dict[Tuple[str, str], float],
    min_score: float = MIN_VIABLE_SCORE,
) -> List[AssignmentResult]:
    """
    Solve maximum-weight bipartite matching between transactions and invoices.

    Parameters
    ----------
    txn_ids          : List of transaction IDs (rows)
    invoice_ids      : List of invoice IDs (columns)
    candidate_scores : Map of (txn_id, invoice_id) -> confidence_score in [0, 100]
    min_score        : Minimum score required to accept an assignment

    Returns
    -------
    List of AssignmentResult for each transaction in txn_ids.
    """
    N = len(txn_ids)
    M = len(invoice_ids)

    if N == 0:
        return []

    # If there are no invoices, all transactions remain unassigned
    if M == 0:
        return [
            AssignmentResult(
                txn_id=tid,
                assigned_invoice_id=None,
                score=0.0,
            )
            for tid in txn_ids
        ]

    # Map IDs to matrix indices
    txn_to_idx = {tid: i for i, tid in enumerate(txn_ids)}
    inv_to_idx = {iid: j for j, iid in enumerate(invoice_ids)}

    # Augmented cost matrix: N rows × (M invoices + N dummy unassigned slots)
    total_cols = M + N
    cost_matrix = np.full((N, total_cols), FORBIDDEN_PAIR_COST, dtype=np.float64)

    # 1. Populate candidate costs: cost = 100 - score
    for (tid, iid), score in candidate_scores.items():
        if tid in txn_to_idx and iid in inv_to_idx:
            i = txn_to_idx[tid]
            j = inv_to_idx[iid]
            if score >= min_score:
                cost_matrix[i, j] = 100.0 - float(score)

    # 2. Populate dummy unassigned columns: cost = 100.0 (score = 0)
    for i in range(N):
        for k in range(N):
            cost_matrix[i, M + k] = UNMATCHED_COST

    # 3. Run Hungarian algorithm (O(N * (M+N)^2) ≈ O(N^3))
    row_ind, col_ind = linear_sum_assignment(cost_matrix)

    # 4. Extract assignments
    results: List[AssignmentResult] = []
    for r, c in zip(row_ind, col_ind):
        tid = txn_ids[r]
        if c < M and cost_matrix[r, c] < UNMATCHED_COST:
            # Valid invoice matched with score > 0
            assigned_inv = invoice_ids[c]
            assigned_score = round(100.0 - cost_matrix[r, c], 2)
            results.append(AssignmentResult(
                txn_id=tid,
                assigned_invoice_id=assigned_inv,
                score=assigned_score,
            ))
        else:
            # Unmatched / assigned to dummy slot
            results.append(AssignmentResult(
                txn_id=tid,
                assigned_invoice_id=None,
                score=0.0,
            ))

    # Maintain original order of txn_ids
    results_by_txn = {r.txn_id: r for r in results}
    return [results_by_txn[tid] for tid in txn_ids]


def apply_hungarian_to_batch(
    pending_matches: List[Tuple],
    all_candidate_scores: Dict[Tuple[str, str], float],
    inv_map: Dict,
) -> Tuple[List[Tuple], List[Tuple[str, str, str]]]:
    """
    Apply Hungarian optimal assignment across pending 1-to-1 matches in a batch.

    Parameters
    ----------
    pending_matches      : List of (match_doc, top_candidate, conf_result, llm_prov, llm_raw, txn_view)
    all_candidate_scores : Map of (txn_id, invoice_id) -> score from passes 1-4
    inv_map              : Map of invoice_id -> InvoiceView

    Returns
    -------
    (updated_pending_matches, reassignments_audit_info)
    reassignments_audit_info: list of (match_id, pass_name, reasoning)
    """
    # Extract 1-to-1 candidate transactions and invoices
    one_to_one_txns = []
    candidate_invoices_set: Set[str] = set()

    for item in pending_matches:
        match, top, cr, llm_prov, llm_raw, txn_view = item
        # Split/batch/noise/duplicate matches have dedicated non-1:1 logic, leave them as-is
        if match.match_type in ("one_to_one", "exception") and top is not None:
            one_to_one_txns.append(txn_view.txn_id)
            if top.invoice_id:
                candidate_invoices_set.add(top.invoice_id)

    # Also collect any other candidate invoices from the scores map
    for (tid, iid) in all_candidate_scores:
        if tid in one_to_one_txns:
            candidate_invoices_set.add(iid)

    # Collect invoices already claimed by split or batch matches
    consumed_invoices_set: Set[str] = set()
    for item in pending_matches:
        match, top, cr, llm_prov, llm_raw, txn_view = item
        if match.match_type in ("split_many_to_one", "batch_one_to_many"):
            for li in match.line_items:
                if li.invoice_id:
                    consumed_invoices_set.add(li.invoice_id)

    # Invoices claimed by multi-record matches must NOT be reassigned to 1:1 txns
    candidate_invoices_set = candidate_invoices_set - consumed_invoices_set

    invoice_ids = sorted(list(candidate_invoices_set))

    if not one_to_one_txns or not invoice_ids:
        return pending_matches, []

    # Solve optimal global assignment
    optimal_assignments = solve_optimal_assignment(
        txn_ids=one_to_one_txns,
        invoice_ids=invoice_ids,
        candidate_scores=all_candidate_scores,
    )
    optimal_map = {res.txn_id: res for res in optimal_assignments}

    updated_matches = []
    audit_entries = []

    for item in pending_matches:
        match, top, cr, llm_prov, llm_raw, txn_view = item
        tid = txn_view.txn_id

        if tid not in optimal_map or match.match_type not in ("one_to_one", "exception") or top is None:
            updated_matches.append(item)
            continue

        opt = optimal_map[tid]
        greedy_inv = top.invoice_id if top else None

        if opt.assigned_invoice_id == greedy_inv:
            # Optimal matches greedy — no change
            updated_matches.append(item)
        elif opt.assigned_invoice_id is not None:
            # Reassigned to a different invoice by Hungarian optimizer
            new_inv_id = opt.assigned_invoice_id
            log.info(
                f"Hungarian optimal reassignment: {tid} -> {new_inv_id} "
                f"(was greedy {greedy_inv})"
            )
            # Update match line item
            match.line_items = [
                type(match.line_items[0])(
                    txn_id=tid,
                    invoice_id=new_inv_id,
                    allocated_amount=txn_view.amount,
                )
            ]
            match.confidence_score = opt.score
            settings = get_settings()
            if opt.score >= settings.threshold_auto_accept:
                match.confidence_band = "auto_accept"
            elif opt.score >= settings.threshold_review:
                match.confidence_band = "review"
            else:
                match.confidence_band = "reject"

            match.explanation_text = (
                f"Globally optimal match via Hungarian algorithm with invoice {new_inv_id} "
                f"(score {opt.score:.1f})."
            )[:280]

            audit_entries.append((
                match.match_id,
                "hungarian_reassignment",
                f"Hungarian algorithm reassigned {tid} from {greedy_inv} to {new_inv_id} "
                f"for global batch optimality (score {opt.score:.1f}).",
            ))
            updated_matches.append((match, top, cr, llm_prov, llm_raw, txn_view))
        else:
            # Demoted: another txn won this invoice at higher global utility.
            # Preserve the original score and apply the SAME confidence-band
            # thresholds used everywhere else in the system — don't invent a
            # separate rule just because this came from the demotion path.
            settings = get_settings()
            review_threshold = settings.threshold_review
            log.info(
                f"Hungarian optimal resolution: {tid} invoice {greedy_inv} claimed by higher-utility match"
            )

            if match.confidence_score < review_threshold:
                match.match_type = "exception"
                match.confidence_band = "reject"
                match.exception_reason_category = "no_viable_candidate"
                match.line_items = [
                    MatchLineItem(
                        txn_id=tid,
                        allocated_amount=txn_view.amount,
                        invoice_id=None,
                    )
                ]
            else:
                # Genuinely competitive candidate that lost a close global contest —
                # keep it visible in review WITH its contested invoice reference
                # intact, so a human reviewer can see exactly what it was competing
                # against. Do not clear line_items in this branch.
                match.confidence_band = "review"
                match.exception_reason_category = "lost_global_assignment"

            match.explanation_text = (
                f"Candidate invoice {greedy_inv} scored {match.confidence_score:.1f}, "
                f"but was assigned to a higher-confidence match elsewhere in this batch. "
                + ("No other viable candidate exists for this transaction."
                   if match.confidence_band == "reject"
                   else "This remains a plausible candidate pending human review.")
            )[:280]

            audit_entries.append((
                match.match_id,
                "hungarian_reassignment",
                f"Candidate {greedy_inv} allocated to higher global utility match. "
                + (f"Match for {tid} closed as exception (score {match.confidence_score:.1f} < {review_threshold})."
                   if match.confidence_band == "reject"
                   else f"Match for {tid} escalated to review (score {match.confidence_score:.1f} >= {review_threshold})."),
            ))
            updated_matches.append((match, top, cr, llm_prov, llm_raw, txn_view))

    return updated_matches, audit_entries
