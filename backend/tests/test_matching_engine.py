"""
Regression tests for the reconciliation matching engine.
Ground truth from bank_statement.csv + invoice_register.csv.

Run: cd backend && .venv/bin/python -m pytest tests/test_matching_engine.py -v
"""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ.setdefault("MONGODB_URI", "x")

import re
import pytest
from decimal import Decimal
from datetime import date
from app.engine.schemas import InvoiceView, TxnView
from app.engine.candidate_filter import narrow_candidates
from app.engine.pass1_rules import run_pass1
from app.engine.pass4_split_matcher import run_pass4_split, run_pass4_batch

_RUPEE_RE = re.compile(r"[₹,\s]")

def pa(raw):
    return Decimal(_RUPEE_RE.sub("", str(raw).strip()))

def make_txn(txn_id, txn_date, amount, narration, direction="credit", channel=None, ref=None):
    return TxnView(txn_id=txn_id, merchant_id="M1", txn_date=date.fromisoformat(txn_date),
                   amount=pa(amount), direction=direction, channel=channel,
                   narration=narration, reference_number=ref)

def make_inv(inv_id, inv_date, counterparty, base, total, tds_section=None, tds="0", net=None, ref=None):
    t = pa(total); b = pa(base); n = pa(net) if net else t; td = pa(tds)
    return InvoiceView(invoice_id=inv_id, merchant_id="M1", counterparty_name=counterparty,
                       invoice_date=date.fromisoformat(inv_date), base_amount=b, total_amount=t,
                       expected_net_amount=n, tds_amount=td, tds_section=tds_section,
                       cgst_amount=Decimal(0), sgst_amount=Decimal(0), igst_amount=Decimal(0),
                       reference_number=ref, status="open")

ALL_INVS = [
    make_inv("INV-001","2026-07-28","Sharma Trading","1,00,000","1,00,000","194J","10000","90000"),
    make_inv("INV-002","2026-08-03","Verma Enterprises","50000","50000",None,"0","50000"),
    make_inv("INV-003","2026-08-08","Mehta Suppliers","100000","118000",None,"0","118000"),
    make_inv("INV-004","2026-08-10","Kapoor Logistics","50000","50000",None,"0","50000"),
    make_inv("INV-005","2026-08-14","Singh Traders","75000","75000",None,"0","75000"),
    make_inv("INV-006","2026-08-15","Reddy Group","70000","70000",None,"0","70000"),
    make_inv("INV-007","2026-08-16","Reddy Group","50000","50000",None,"0","50000"),
    make_inv("INV-008","2026-08-18","Gupta Associates","85000","85000","194C","0","85000"),
]
INV_MAP = {i.invoice_id: i for i in ALL_INVS}


# ── Step 1: Amount parser (Indian digit grouping) ──────────────────────────────

def test_amount_parser_indian_grouping():
    """CSV parser correctly converts Indian comma-formatted amounts."""
    assert pa("90,000")   == Decimal("90000"),  "90,000 -> 90000"
    assert pa("1,00,000") == Decimal("100000"), "1,00,000 -> 100000"
    assert pa("1,20,000") == Decimal("120000"), "1,20,000 -> 120000"
    assert pa("118000")   == Decimal("118000"), "plain integer unchanged"
    assert pa("85000")    == Decimal("85000"),  "plain integer unchanged"
    assert pa("50000")    == Decimal("50000"),  "plain integer unchanged"
    assert pa("25000")    == Decimal("25000"),  "plain integer unchanged"


# ── TXN-003: exact match, no UTR on invoice ────────────────────────────────────

def test_txn003_candidates_include_inv003():
    t = make_txn("TXN-003","2026-08-10","118000","GST Invoice settled Mehta Suppliers","credit","RTGS","UTR2026081000003")
    cands = narrow_candidates(t, ALL_INVS)
    assert "INV-003" in [c.invoice_id for c in cands]

def test_txn003_pass1_resolves_with_high_score():
    t = make_txn("TXN-003","2026-08-10","118000","GST Invoice settled Mehta Suppliers","credit","RTGS","UTR2026081000003")
    cands = narrow_candidates(t, ALL_INVS)
    results = run_pass1(t, cands)
    assert results[0].invoice_id == "INV-003"
    assert results[0].resolved_by == "pass1_rules", f"score={results[0].score}"
    assert results[0].score >= 90.0, f"TXN-003 score {results[0].score} < 90.0"


# ── TXN-008: exact match (tds_amount=0) ───────────────────────────────────────

def test_txn008_pass1_resolves_with_high_score():
    t = make_txn("TXN-008","2026-08-20","85000","NEFT Gupta Associates payment","credit","NEFT","UTR2026082000008")
    cands = narrow_candidates(t, ALL_INVS)
    assert "INV-008" in [c.invoice_id for c in cands]
    results = run_pass1(t, cands)
    assert results[0].invoice_id == "INV-008"
    assert results[0].resolved_by == "pass1_rules"
    assert results[0].score >= 90.0, f"TXN-008 score {results[0].score} < 90.0"


# ── TXN-001: TDS-formula match ─────────────────────────────────────────────────

def test_txn001_pass1_resolves():
    t = make_txn("TXN-001","2026-08-01","90,000","NEFT from Sharma Trading 194J TDS deducted","credit","NEFT","UTR2026080100001")
    cands = narrow_candidates(t, ALL_INVS)
    assert "INV-001" in [c.invoice_id for c in cands]
    results = run_pass1(t, cands)
    assert results[0].invoice_id == "INV-001"
    assert results[0].resolved_by == "pass1_rules"
    assert results[0].score >= 90.0, f"TXN-001 score {results[0].score} < 90.0"


# ── TXN-004/005: split match ───────────────────────────────────────────────────

def test_txn004_candidates_include_inv004():
    """INV-004 (50k) must survive the amount filter for TXN-004 (25k split payment)."""
    t = make_txn("TXN-004","2026-08-12","25000","Part payment Kapoor Logistics INV-004","credit","NEFT")
    cands = narrow_candidates(t, ALL_INVS)
    assert "INV-004" in [c.invoice_id for c in cands], f"candidates: {[c.invoice_id for c in cands]}"

def test_txn004_txn005_split_match():
    t4 = make_txn("TXN-004","2026-08-12","25000","Part payment Kapoor Logistics INV-004","credit","NEFT")
    t5 = make_txn("TXN-005","2026-08-12","25000","Part payment Kapoor Logistics INV-004 second","credit","NEFT")
    result = run_pass4_split(INV_MAP["INV-004"], [t4, t5], None)
    assert result.match_type == "split_many_to_one"
    assert set(result.txn_ids) == {"TXN-004", "TXN-005"}
    assert result.confidence_delta >= 40.0


# ── TXN-007: batch match ───────────────────────────────────────────────────────

def test_txn007_candidates_include_inv006_inv007():
    t = make_txn("TXN-007","2026-08-18","1,20,000","Batch payout Reddy Group INV-006 INV-007","credit","RTGS")
    cands = narrow_candidates(t, ALL_INVS)
    ids = [c.invoice_id for c in cands]
    assert "INV-006" in ids, f"INV-006 missing: {ids}"
    assert "INV-007" in ids, f"INV-007 missing: {ids}"

def test_txn007_batch_match():
    t = make_txn("TXN-007","2026-08-18","1,20,000","Batch payout Reddy Group INV-006 INV-007","credit","RTGS")
    cands = narrow_candidates(t, ALL_INVS)
    result = run_pass4_batch(t, cands, None)
    assert result.match_type == "batch_one_to_many"
    assert set(result.invoice_ids) == {"INV-006", "INV-007"}
    assert result.confidence_delta >= 40.0


# ── Exception Explanation Text Invariant Tests ───────────────────────────────

@pytest.mark.asyncio
async def test_all_exception_code_paths_have_non_empty_explanation():
    """Every exception path must populate a non-empty explanation_text."""
    from unittest.mock import MagicMock
    from app.models.match import Match
    from app.engine.orchestrator import _match_one_txn
    from app.core.config import get_settings

    if Match._document_settings is None:
        Match._document_settings = MagicMock()

    settings = get_settings()

    # 1. Debit exception
    t_debit = make_txn("TXN-DEBIT", "2026-08-01", "50000", "Refund debit to vendor", direction="debit")
    m_debit = await _match_one_txn(t_debit, ALL_INVS, INV_MAP, [t_debit], "B1", "R1", None, settings, set(), set())
    assert m_debit.match_type == "exception"
    assert m_debit.confidence_band == "reject"
    assert m_debit.explanation_text and len(m_debit.explanation_text.strip()) > 0
    assert "debit" in m_debit.explanation_text.lower()

    # 2. Noise exception
    t_noise = make_txn("TXN-NOISE", "2026-08-01", "10", "Bank interest credit")
    m_noise = await _match_one_txn(t_noise, ALL_INVS, INV_MAP, [t_noise], "B1", "R1", None, settings, set(), set())
    assert m_noise.match_type == "exception"
    assert m_noise.confidence_band == "reject"
    assert m_noise.explanation_text and len(m_noise.explanation_text.strip()) > 0
    assert "noise" in m_noise.explanation_text.lower() or "below" in m_noise.explanation_text.lower()

    # 3. No candidate in window exception
    t_none = make_txn("TXN-UNKNOWN", "2025-01-01", "999999", "Random old vendor payment")
    m_none = await _match_one_txn(t_none, ALL_INVS, INV_MAP, [t_none], "B1", "R1", None, settings, set(), set())
    assert m_none.match_type == "exception"
    assert m_none.confidence_band == "reject"
    assert m_none.explanation_text and len(m_none.explanation_text.strip()) > 0
    assert "candidate" in m_none.explanation_text.lower() or "no" in m_none.explanation_text.lower()

    # 4. Duplicate exception
    t_orig = make_txn("TXN-ORIG", "2026-08-01", "50000", "Vendor payout")
    t_dup  = make_txn("TXN-DUP",  "2026-08-02", "50000", "Vendor payout")
    m_dup = await _match_one_txn(t_dup, ALL_INVS, INV_MAP, [t_orig, t_dup], "B1", "R1", None, settings, set(), set())
    assert m_dup.match_type == "exception"
    assert m_dup.confidence_band == "reject"
    assert m_dup.explanation_text and len(m_dup.explanation_text.strip()) > 0
    assert "duplicate" in m_dup.explanation_text.lower()


def test_hungarian_demotion_has_non_empty_explanation():
    """Hungarian demoted match has detailed non-empty explanation_text."""
    from unittest.mock import MagicMock
    from app.engine.hungarian_matcher import apply_hungarian_to_batch
    from app.models.match import Match, MatchLineItem
    from app.engine.schemas import CandidateMatch
    from app.engine.confidence_scorer import ConfidenceResult

    if Match._document_settings is None:
        Match._document_settings = MagicMock()

    # Mock a match that lost its candidate to a higher-utility winner
    t10 = make_txn("TXN-010", "2026-08-25", "99999", "Unknown counterparty payment")
    match10 = Match(
        match_id="MATCH-10", batch_id="B1", run_id="R1",
        match_type="one_to_one", confidence_score=39.4, confidence_band="reject",
        line_items=[MatchLineItem(txn_id="TXN-010", invoice_id="INV-001", allocated_amount=Decimal("99999"))],
        threshold_snapshot={},
    )
    top10 = CandidateMatch(invoice_id="INV-001", txn_id="TXN-010")
    cr10 = ConfidenceResult(invoice_id="INV-001", txn_id="TXN-010", pass_score=35.0, llm_delta=0.0,
                            final_score=39.4, band="reject", decision="reject", explanation="Candidate match",
                            gate_human_review=False, gate_exception=False, gate_hard_floor=False, gate_flagged_llm=False,
                            threshold_snapshot={})

    # Only provide candidate score for TXN-001 -> INV-001 with 92.2, so TXN-010 gets unassigned
    candidate_scores = {
        ("TXN-001", "INV-001"): 92.2,
        ("TXN-010", "INV-001"): 39.4,
    }

    t1 = make_txn("TXN-001", "2026-08-01", "90000", "Sharma Trading payment")
    match1 = Match(
        match_id="MATCH-1", batch_id="B1", run_id="R1",
        match_type="one_to_one", confidence_score=92.2, confidence_band="auto_accept",
        line_items=[MatchLineItem(txn_id="TXN-001", invoice_id="INV-001", allocated_amount=Decimal("90000"))],
        threshold_snapshot={},
    )
    top1 = CandidateMatch(invoice_id="INV-001", txn_id="TXN-001")
    cr1 = ConfidenceResult(invoice_id="INV-001", txn_id="TXN-001", pass_score=92.2, llm_delta=0.0,
                           final_score=92.2, band="auto_accept", decision="auto_accept", explanation="Exact match",
                           gate_human_review=False, gate_exception=False, gate_hard_floor=False, gate_flagged_llm=False,
                           threshold_snapshot={})

    pending = [
        (match10, top10, cr10, "none", "", t10),
        (match1, top1, cr1, "none", "", t1),
    ]

    updated, audits = apply_hungarian_to_batch(pending, candidate_scores, INV_MAP)
    m10_updated = next(m for m, *rest in updated if "TXN-010" in [li.txn_id for li in m.line_items])

    assert m10_updated.match_type == "exception"
    assert m10_updated.confidence_band == "reject"
    assert m10_updated.line_items[0].invoice_id is None
    assert m10_updated.explanation_text and len(m10_updated.explanation_text.strip()) > 0
    assert "INV-001" in m10_updated.explanation_text

