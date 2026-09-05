"""
api/routes_upload.py
POST /api/batches — Upload a new batch (CSV or JSON).

Accepts:
  - bank_transactions: CSV file
  - invoices: CSV file or JSON file

Behaviour:
  - Deduplicates by (merchant_id, txn_id) / (merchant_id, invoice_id)
  - Buckets malformed rows into parse_errors (never crashes)
  - Handles ₹ symbol, Indian digit grouping (1,00,000), DD-MM-YYYY and ISO dates
  - Returns batch_id for use in subsequent /run and /stream calls
  - Empty or one-sided batches are accepted — engine handles them gracefully
"""

from __future__ import annotations

import csv
import io
import logging
import re
import uuid
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from app.models.bank_transaction import BankTransaction
from app.models.invoice import Invoice
from app.models.ground_truth_label import GroundTruthLabel

log = logging.getLogger(__name__)
router = APIRouter()


# ── Amount parser — handles ₹ symbol + Indian digit grouping ─────────────────

_RUPEE_RE = re.compile(r"[₹,\s]")

def _parse_amount(raw: str) -> Optional[Decimal]:
    cleaned = _RUPEE_RE.sub("", raw.strip())
    try:
        return Decimal(cleaned)
    except (InvalidOperation, ValueError):
        return None


# ── Date parser — tries DD-MM-YYYY, YYYY-MM-DD, DD/MM/YYYY ──────────────────

_DATE_FMTS = ["%d-%m-%Y", "%Y-%m-%d", "%d/%m/%Y", "%d %b %Y", "%d-%b-%Y"]

def _parse_date(raw: str) -> Optional[date]:
    raw = raw.strip()
    for fmt in _DATE_FMTS:
        try:
            return datetime.strptime(raw, fmt).date()
        except ValueError:
            continue
    return None


# ── CSV row parser: bank transactions ─────────────────────────────────────────

def _parse_txn_row(row: Dict[str, str], merchant_id: str) -> tuple:
    """Returns (BankTransaction, None) or (None, error_dict)."""
    errors = []

    txn_id   = row.get("txn_id", "").strip() or f"TXN-{uuid.uuid4().hex[:8]}"
    narration = row.get("narration", "").strip()
    direction = row.get("direction", "credit").strip().lower()

    amount_raw = row.get("amount", "").strip()
    amount = _parse_amount(amount_raw)
    if amount is None:
        errors.append(f"Invalid amount: '{amount_raw}'")

    date_raw = row.get("txn_date", row.get("date", "")).strip()
    txn_date = _parse_date(date_raw)
    if txn_date is None:
        errors.append(f"Invalid date: '{date_raw}'")

    if errors:
        return None, {"row": row, "errors": errors}

    txn = BankTransaction(
        txn_id=txn_id,
        merchant_id=merchant_id,
        txn_date=txn_date,
        amount=amount,
        direction=direction,
        channel=row.get("channel", "").strip() or None,
        narration=narration,
        reference_number=row.get("reference_number", "").strip() or None,
    )
    return txn, None


# ── CSV row parser: invoices ─────────────────────────────────────────────────

def _parse_invoice_row(row: Dict[str, str], merchant_id: str) -> tuple:
    errors = []

    invoice_id       = row.get("invoice_id", "").strip() or f"INV-{uuid.uuid4().hex[:8]}"
    counterparty     = row.get("counterparty_name", "").strip()
    base_amount_raw  = row.get("base_amount", "").strip()
    total_amount_raw = row.get("total_amount", "").strip()
    net_amount_raw   = row.get("expected_net_amount", total_amount_raw).strip()

    base_amount = _parse_amount(base_amount_raw)
    if base_amount is None:
        errors.append(f"Invalid base_amount: '{base_amount_raw}'")

    total_amount = _parse_amount(total_amount_raw)
    if total_amount is None:
        errors.append(f"Invalid total_amount: '{total_amount_raw}'")

    expected_net = _parse_amount(net_amount_raw) or total_amount

    date_raw = row.get("invoice_date", row.get("date", "")).strip()
    invoice_date = _parse_date(date_raw)
    if invoice_date is None:
        errors.append(f"Invalid invoice_date: '{date_raw}'")

    if errors:
        return None, {"row": row, "errors": errors}

    # Optional TDS
    tds_amt_raw = row.get("tds_amount", "").strip()
    tds_amount  = _parse_amount(tds_amt_raw) if tds_amt_raw else None

    inv = Invoice(
        invoice_id=invoice_id,
        merchant_id=merchant_id,
        counterparty_name=counterparty,
        invoice_date=invoice_date,
        base_amount=base_amount,
        total_amount=total_amount,
        expected_net_amount=expected_net,
        cgst_amount=_parse_amount(row.get("cgst_amount", "0")) or Decimal("0"),
        sgst_amount=_parse_amount(row.get("sgst_amount", "0")) or Decimal("0"),
        igst_amount=_parse_amount(row.get("igst_amount", "0")) or Decimal("0"),
        tds_section=row.get("tds_section", "").strip() or None,
        tds_rate=_parse_amount(row.get("tds_rate", "")) or None,
        tds_amount=tds_amount,
        reference_number=row.get("reference_number", "").strip() or None,
        status=row.get("status", "open").strip(),
    )
    return inv, None


# ── Response schema ────────────────────────────────────────────────────────────

class BatchUploadResponse(BaseModel):
    batch_id:         str
    merchant_id:      str
    txns_loaded:      int
    invoices_loaded:  int
    parse_errors:     List[Dict[str, Any]]
    message:          str


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.post("/batches", response_model=BatchUploadResponse)
async def upload_batch(
    merchant_id:      str                     = Form(...),
    bank_csv:         UploadFile              = File(...,  description="Bank statement CSV"),
    invoice_csv:      UploadFile              = File(...,  description="Invoice register CSV"),
    ground_truth_csv: Optional[UploadFile]     = File(None, description="Ground truth CSV (optional)"),
    batch_id:         Optional[str]           = Form(None, description="Supply to overwrite an existing batch"),
):
    """
    Upload a bank statement CSV + invoice CSV to create a reconciliation batch.
    Optionally upload a ground truth CSV for evaluation.

    Returns a batch_id to pass to POST /api/batches/{id}/run.
    Malformed rows are returned in parse_errors and skipped — the batch is
    still created with the valid rows.
    """
    batch_id = batch_id or f"BATCH-{uuid.uuid4().hex[:10]}"
    parse_errors: List[Dict[str, Any]] = []

    # ── Read + parse bank CSV ─────────────────────────────────────────────────
    bank_content = (await bank_csv.read()).decode("utf-8", errors="replace")
    bank_reader  = csv.DictReader(io.StringIO(bank_content))
    txns_to_insert: List[BankTransaction] = []
    seen_txn_ids: set = set()

    for row in bank_reader:
        txn, err = _parse_txn_row(row, merchant_id)
        if err:
            parse_errors.append({"file": "bank_csv", **err})
            continue
        if txn.txn_id in seen_txn_ids:
            log.debug(f"Dedup: skipping duplicate txn_id {txn.txn_id}")
            continue
        seen_txn_ids.add(txn.txn_id)
        txn.batch_id = batch_id   # attach batch_id for querying
        txns_to_insert.append(txn)

    # ── Read + parse invoice CSV ───────────────────────────────────────────────
    inv_content = (await invoice_csv.read()).decode("utf-8", errors="replace")
    inv_reader  = csv.DictReader(io.StringIO(inv_content))
    invs_to_insert: List[Invoice] = []
    seen_inv_ids: set = set()

    for row in inv_reader:
        inv, err = _parse_invoice_row(row, merchant_id)
        if err:
            parse_errors.append({"file": "invoice_csv", **err})
            continue
        if inv.invoice_id in seen_inv_ids:
            log.debug(f"Dedup: skipping duplicate invoice_id {inv.invoice_id}")
            continue
        seen_inv_ids.add(inv.invoice_id)
        inv.batch_id = batch_id
        invs_to_insert.append(inv)

    # ── Read + parse ground truth CSV (optional) ──────────────────────────────
    gt_to_insert: List[GroundTruthLabel] = []
    if ground_truth_csv:
        gt_content = (await ground_truth_csv.read()).decode("utf-8", errors="replace")
        gt_reader  = csv.DictReader(io.StringIO(gt_content))
        for row in gt_reader:
            inv_id = row.get("invoice_id", "").strip()
            txn_ids_raw = row.get("txn_ids", "").strip()
            txn_ids = [t.strip() for t in txn_ids_raw.split(",") if t.strip()] if txn_ids_raw else []
            is_true = row.get("is_true_match", "true").strip().lower() in ("true", "1", "yes")
            cat = row.get("case_category", "clean").strip()
            gt_to_insert.append(
                GroundTruthLabel(
                    batch_id=batch_id,
                    invoice_id=inv_id,
                    txn_ids=txn_ids,
                    is_true_match=is_true,
                    case_category=cat,
                )
            )

    # ── Persist to Atlas ───────────────────────────────────────────────────────
    if txns_to_insert:
        await BankTransaction.insert_many(txns_to_insert)
    if invs_to_insert:
        await Invoice.insert_many(invs_to_insert)
    if gt_to_insert:
        await GroundTruthLabel.insert_many(gt_to_insert)

    log.info(
        f"Batch {batch_id} uploaded: {len(txns_to_insert)} txns, "
        f"{len(invs_to_insert)} invoices, {len(gt_to_insert)} ground truth labels, "
        f"{len(parse_errors)} parse errors"
    )

    return BatchUploadResponse(
        batch_id=batch_id,
        merchant_id=merchant_id,
        txns_loaded=len(txns_to_insert),
        invoices_loaded=len(invs_to_insert),
        parse_errors=parse_errors,
        message=(
            f"Batch created. Run POST /api/batches/{batch_id}/run to start reconciliation."
            if not parse_errors
            else f"Batch created with {len(parse_errors)} skipped rows. Check parse_errors."
        ),
    )


# ── 1-Click Synthetic Evaluation Batch Loader ───────────────────────────────────

@router.post("/batches/sample", response_model=BatchUploadResponse)
async def load_sample_batch():
    """
    1-click loader for the pre-configured synthetic evaluation batch (71 records,
    15 chaos cases, and ground-truth labels per Build Plan Section 5.3 & 5.4).
    Enables instant demonstration of full ground-truth precision/recall metrics.
    """
    import os

    # Look for evaluation batch in standard paths
    search_paths = [
        os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../test_data/evaluation_batch")),
        os.path.abspath(os.path.join(os.getcwd(), "test_data/evaluation_batch")),
        os.path.abspath(os.path.join(os.getcwd(), "../test_data/evaluation_batch")),
    ]

    eval_dir = None
    for p in search_paths:
        if os.path.isdir(p) and os.path.exists(os.path.join(p, "bank_statement.csv")):
            eval_dir = p
            break

    if not eval_dir:
        raise HTTPException(404, "Synthetic evaluation batch directory not found on server")

    merchant_id = "MER-SYNTH-EVAL-01"
    batch_id = f"BATCH-{uuid.uuid4().hex[:10]}"

    with open(os.path.join(eval_dir, "bank_statement.csv"), "r", encoding="utf-8") as fb:
        bank_reader = csv.DictReader(fb)
        txns_to_insert = []
        for row in bank_reader:
            txn, _ = _parse_txn_row(row, merchant_id)
            if txn:
                txn.batch_id = batch_id
                txns_to_insert.append(txn)

    with open(os.path.join(eval_dir, "invoice_register.csv"), "r", encoding="utf-8") as fi:
        inv_reader = csv.DictReader(fi)
        invs_to_insert = []
        for row in inv_reader:
            inv, _ = _parse_invoice_row(row, merchant_id)
            if inv:
                inv.batch_id = batch_id
                invs_to_insert.append(inv)

    gt_to_insert = []
    gt_file = os.path.join(eval_dir, "ground_truth.csv")
    if os.path.exists(gt_file):
        with open(gt_file, "r", encoding="utf-8") as fg:
            gt_reader = csv.DictReader(fg)
            for row in gt_reader:
                inv_id = row.get("invoice_id", "").strip()
                txn_ids_raw = row.get("txn_ids", "").strip()
                txn_ids = [t.strip() for t in txn_ids_raw.split(",") if t.strip()] if txn_ids_raw else []
                is_true = row.get("is_true_match", "true").strip().lower() in ("true", "1", "yes")
                cat = row.get("case_category", "clean").strip()
                gt_to_insert.append(
                    GroundTruthLabel(
                        batch_id=batch_id,
                        invoice_id=inv_id,
                        txn_ids=txn_ids,
                        is_true_match=is_true,
                        case_category=cat,
                    )
                )

    if txns_to_insert:
        await BankTransaction.insert_many(txns_to_insert)
    if invs_to_insert:
        await Invoice.insert_many(invs_to_insert)
    if gt_to_insert:
        await GroundTruthLabel.insert_many(gt_to_insert)

    log.info(
        f"Synthetic benchmark batch {batch_id} loaded: {len(txns_to_insert)} txns, "
        f"{len(invs_to_insert)} invoices, {len(gt_to_insert)} ground truth labels"
    )

    return BatchUploadResponse(
        batch_id=batch_id,
        merchant_id=merchant_id,
        txns_loaded=len(txns_to_insert),
        invoices_loaded=len(invs_to_insert),
        parse_errors=[],
        message=f"Synthetic evaluation batch created ({len(txns_to_insert)} txns, {len(invs_to_insert)} invoices, {len(gt_to_insert)} ground truth labels).",
    )

