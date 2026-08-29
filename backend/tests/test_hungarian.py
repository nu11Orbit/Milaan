"""
tests/test_hungarian.py
Unit tests for the Hungarian Algorithm (Globally Optimal Bipartite Matching).
"""

from __future__ import annotations

import pytest
from app.engine.hungarian_matcher import (
    AssignmentResult,
    solve_optimal_assignment,
)


class TestHungarianAssignment:

    def test_identity_one_to_one_no_conflict(self):
        """When there is no competition, each txn matches its unique invoice."""
        txns = ["TXN-1", "TXN-2"]
        invs = ["INV-A", "INV-B"]
        scores = {
            ("TXN-1", "INV-A"): 95.0,
            ("TXN-2", "INV-B"): 90.0,
        }
        res = solve_optimal_assignment(txns, invs, scores)
        res_map = {r.txn_id: r.assigned_invoice_id for r in res}
        assert res_map["TXN-1"] == "INV-A"
        assert res_map["TXN-2"] == "INV-B"

    def test_hungarian_beats_suboptimal_greedy(self):
        """
        Classic 2x2 competition where greedy order yields sub-optimal total score:
          Txn 1: Inv A (score 82)
          Txn 2: Inv A (score 98), Inv B (score 80)
          Txn 3: Inv B (score 75)

        Greedy sequence (if Txn 1 runs first):
          Txn 1 -> Inv A (82)
          Txn 2 -> Inv B (80)
          Txn 3 -> Unmatched (0)
          Total = 162

        Hungarian global optimum:
          Txn 2 -> Inv A (98)
          Txn 3 -> Inv B (75)
          Txn 1 -> Unmatched (0)
          Total = 173 (> 162)
        """
        txns = ["TXN-1", "TXN-2", "TXN-3"]
        invs = ["INV-A", "INV-B"]
        scores = {
            ("TXN-1", "INV-A"): 82.0,
            ("TXN-2", "INV-A"): 98.0,
            ("TXN-2", "INV-B"): 80.0,
            ("TXN-3", "INV-B"): 75.0,
        }
        res = solve_optimal_assignment(txns, invs, scores)
        res_map = {r.txn_id: r.assigned_invoice_id for r in res}

        assert res_map["TXN-2"] == "INV-A"
        assert res_map["TXN-3"] == "INV-B"
        assert res_map["TXN-1"] is None

        # Verify total score
        total_score = sum(r.score for r in res)
        assert total_score == pytest.approx(173.0, abs=0.1)

    def test_no_duplicate_invoice_assignment(self):
        """An invoice can never be assigned to more than one transaction."""
        txns = ["TXN-1", "TXN-2", "TXN-3", "TXN-4"]
        invs = ["INV-A", "INV-B"]
        scores = {
            ("TXN-1", "INV-A"): 90.0,
            ("TXN-2", "INV-A"): 85.0,
            ("TXN-3", "INV-B"): 88.0,
            ("TXN-4", "INV-B"): 70.0,
        }
        res = solve_optimal_assignment(txns, invs, scores)
        assigned_invs = [r.assigned_invoice_id for r in res if r.assigned_invoice_id is not None]
        assert len(assigned_invs) == len(set(assigned_invs)), "Duplicate invoice assignment detected!"
        assert "INV-A" in assigned_invs
        assert "INV-B" in assigned_invs

    def test_score_below_threshold_is_not_assigned(self):
        """Scores below min_score (30.0) should remain unassigned."""
        txns = ["TXN-1"]
        invs = ["INV-A"]
        scores = {("TXN-1", "INV-A"): 25.0}  # Below 30.0 threshold
        res = solve_optimal_assignment(txns, invs, scores, min_score=30.0)
        assert res[0].assigned_invoice_id is None
        assert res[0].score == 0.0

    def test_empty_transactions(self):
        """Empty input lists return empty result without error."""
        res = solve_optimal_assignment([], ["INV-A"], {})
        assert res == []

    def test_empty_invoices(self):
        """When no invoices are provided, all txns are unassigned."""
        txns = ["TXN-1", "TXN-2"]
        res = solve_optimal_assignment(txns, [], {})
        assert len(res) == 2
        assert res[0].assigned_invoice_id is None
        assert res[1].assigned_invoice_id is None

    def test_more_invoices_than_transactions(self):
        """When M > N, every transaction gets its optimal invoice and leftovers remain unassigned."""
        txns = ["TXN-1"]
        invs = ["INV-A", "INV-B", "INV-C"]
        scores = {
            ("TXN-1", "INV-A"): 50.0,
            ("TXN-1", "INV-B"): 95.0,
            ("TXN-1", "INV-C"): 70.0,
        }
        res = solve_optimal_assignment(txns, invs, scores)
        assert res[0].assigned_invoice_id == "INV-B"
        assert res[0].score == pytest.approx(95.0, abs=0.1)
