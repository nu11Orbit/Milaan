"""
data/generate_synthetic_data.py
================================
Generates a complete synthetic reconciliation dataset for ReconAI and writes it
to MongoDB Atlas.  All 15 chaos cases from the build plan are injected.

Usage (from /Milaan/backend/ with .venv active):
    python data/generate_synthetic_data.py
    python data/generate_synthetic_data.py --merchants 5 --invoices-per-merchant 40

The script writes:
    • Merchant          documents
    • Invoice           documents
    • BankTransaction   documents
    • GroundTruthLabel  documents

Ground-truth labels are written BEFORE chaos injection mutates the records,
so labels are always clean regardless of what chaos does to the data.

Design rules
─────────────
• All monetary values are Python Decimal throughout — NO float arithmetic.
• GST split: same state_code → CGST + SGST; different → IGST only.
• TDS: deducted from invoice total, subtracted to get expected_net_amount.
• Gateway fee (Razorpay-style) only applied to cases where payment_channel="UPI".
• Each invoice maps to exactly one chaos case (or "clean").
• Exactly 15% of invoices have no reference number (case 9).
• Exactly 5%  of invoices have a truncated reference number (case 10).
"""

from __future__ import annotations

import asyncio
import argparse
import random
import uuid
import logging
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional

from faker import Faker
import motor.motor_asyncio
from beanie import init_beanie

# ── Local imports ──────────────────────────────────────────────────────────────
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.config import get_settings
from app.models.merchant import Merchant
from app.models.invoice import Invoice
from app.models.bank_transaction import BankTransaction
from app.models.match import Match
from app.models.audit_log_entry import AuditLogEntry
from app.models.ground_truth_label import GroundTruthLabel

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
log = logging.getLogger(__name__)
fake = Faker("en_IN")

# ─────────────────────────────────────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────────────────────────────────────

INDIAN_STATE_CODES = {
    "07": "Delhi",
    "27": "Maharashtra",
    "29": "Karnataka",
    "33": "Tamil Nadu",
    "36": "Telangana",
    "09": "Uttar Pradesh",
    "19": "West Bengal",
    "24": "Gujarat",
    "06": "Haryana",
    "32": "Kerala",
}

GST_RATES = [Decimal("0"), Decimal("5"), Decimal("12"), Decimal("18"), Decimal("28")]

# TDS sections with their standard rates
TDS_SECTIONS = {
    "194J": Decimal("0.10"),   # Professional/technical services
    "194C": Decimal("0.02"),   # Contractor payments
    "194Q": Decimal("0.001"),  # Purchase of goods > ₹50L
    "194I": Decimal("0.10"),   # Rent
    "194H": Decimal("0.05"),   # Commission/brokerage
}

# Razorpay-style gateway fee: 2% + 18% GST on that fee = 2.36% effective
GATEWAY_FEE_RATE   = Decimal("0.02")
GATEWAY_GST_RATE   = Decimal("0.18")
GATEWAY_EFFECTIVE  = GATEWAY_FEE_RATE * (1 + GATEWAY_GST_RATE)  # 0.0236

# Chaos case distribution (must sum to 1.0 across all case types + "clean")
# We make ~30% clean, rest distributed across 15 cases
CASE_WEIGHTS = {
    "clean": 20,
    "1":  5,   # exact 1:1 (same as clean but explicitly labeled)
    "2":  5,   # GST rounding drift
    "3":  6,   # TDS-adjusted settlement
    "4":  5,   # split settlement
    "5":  4,   # batched payout
    "6":  5,   # partial payment
    "7":  3,   # partial refund
    "8":  5,   # near-duplicate confusion
    "9":  7,   # missing reference number
    "10": 4,   # truncated reference number
    "11": 5,   # date lag outlier
    "12": 4,   # orphan bank transaction
    "13": 4,   # unpaid invoice
    "14": 6,   # narration/name mismatch
    "15": 3,   # duplicate bank transaction
}
CASE_POPULATION = list(CASE_WEIGHTS.keys())
CASE_WEIGHTS_LIST = [CASE_WEIGHTS[k] for k in CASE_POPULATION]

# ─────────────────────────────────────────────────────────────────────────────
# Helper utilities
# ─────────────────────────────────────────────────────────────────────────────

def rupee(value: float | Decimal, places: int = 2) -> Decimal:
    """Round to nearest paisa (2 decimal places) using ROUND_HALF_UP."""
    return Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def random_base_amount() -> Decimal:
    """Generate a realistic B2B invoice base amount (₹500 – ₹5,00,000)."""
    # Biased toward smaller amounts — most SME invoices are sub-₹1L
    bucket = random.choices(
        [(500, 10_000), (10_001, 1_00_000), (1_00_001, 5_00_000)],
        weights=[50, 40, 10],
    )[0]
    amount = random.uniform(bucket[0], bucket[1])
    # Round to nearest 100 (realistic invoice amounts)
    return rupee(round(amount / 100) * 100)


def compute_gst(base: Decimal, gst_rate: Decimal, intrastate: bool) -> tuple[Decimal, Decimal, Decimal]:
    """
    Returns (cgst_amount, sgst_amount, igst_amount).
    Intrastate: CGST = SGST = gst_rate/2 each.
    Interstate: IGST = full gst_rate.
    """
    total_gst = rupee(base * gst_rate / 100)
    if intrastate:
        half = rupee(total_gst / 2)
        return half, half, Decimal("0")
    else:
        return Decimal("0"), Decimal("0"), total_gst


def random_utr() -> str:
    """Generate a realistic UTR / NEFT reference number."""
    bank_codes = ["HDFC", "ICICI", "AXIS", "SBI", "KOTAK", "YES", "PNB"]
    return f"{''.join(random.choices('0123456789', k=12))}"


def random_upi_ref() -> str:
    return f"{''.join(random.choices('0123456789', k=12))}"


def abbrev(name: str, max_len: int = 12) -> str:
    """Shorten a company name to a realistic bank-narration abbreviation."""
    # Take first word + truncate
    words = name.upper().replace("PVT", "").replace("LTD", "").replace(".", "").split()
    abbr = "".join(w[:4] for w in words[:3])
    return abbr[:max_len]


def make_narration(channel: str, counterparty: str, reference: Optional[str], memo: str = "") -> str:
    """Generate realistic bank narration string for the given channel."""
    abbr_name = abbrev(counterparty)
    if channel == "UPI":
        ref = reference or random_upi_ref()
        return f"UPI/{abbr_name}/{ref}/{memo or 'PAYMENT'}"
    elif channel == "NEFT":
        ref = reference or random_utr()
        return f"NEFT-{ref}-{counterparty[:20].upper()}"
    elif channel == "IMPS":
        ref = reference or random_utr()
        return f"IMPS/{ref}/{abbr_name}"
    elif channel == "RTGS":
        ref = reference or random_utr()
        return f"RTGS/{ref}/{counterparty[:20].upper()}"
    elif channel == "cheque":
        chq = f"{''.join(random.choices('0123456789', k=6))}"
        return f"CHQ DEP {chq}/{abbr_name}"
    else:
        return f"CREDIT/{counterparty[:20]}"


def random_company_name() -> str:
    suffixes = ["Pvt Ltd", "Ltd", "Enterprises", "Solutions", "Trading Co", "Associates", "Services"]
    first = random.choice([
        fake.last_name(), fake.first_name(),
        fake.city()[:8], fake.word().capitalize()
    ])
    return f"{first} {random.choice(suffixes)}"


def random_gstin(state_code: str) -> str:
    """Generate a plausible (not verified) GSTIN."""
    pan = "".join(random.choices("ABCDEFGHIJKLMNOPQRSTUVWXYZ", k=5))
    pan += "".join(random.choices("0123456789", k=4))
    pan += random.choice("ABCDEFGHIJKLMNOPQRSTUVWXYZ")
    entity = random.choice("1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ")
    checksum = random.choice("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")
    return f"{state_code}{pan}{entity}Z{checksum}"


# ─────────────────────────────────────────────────────────────────────────────
# Data generators
# ─────────────────────────────────────────────────────────────────────────────

def make_merchant() -> Merchant:
    state_code = random.choice(list(INDIAN_STATE_CODES.keys()))
    return Merchant(
        merchant_id=f"MER-{uuid.uuid4().hex[:8].upper()}",
        name=random_company_name(),
        gstin=random_gstin(state_code),
        state_code=state_code,
        bank_account_masked=str(random.randint(1000, 9999)),
    )


def make_invoice(
    merchant: Merchant,
    invoice_date: date,
    case: str,
) -> Invoice:
    """
    Create one invoice.  The `case` tag is used to tune specific fields
    (e.g. case 3 will always have TDS applied).
    """
    counterparty_state = random.choice(list(INDIAN_STATE_CODES.keys()))
    intrastate = (counterparty_state == merchant.state_code)
    gst_rate = random.choice(GST_RATES)

    # TDS: applied in cases 3 and ~20% of clean cases
    apply_tds = (case == "3") or (case == "clean" and random.random() < 0.20)
    tds_section = None
    tds_rate = None
    tds_amount = None

    base = random_base_amount()
    cgst, sgst, igst = compute_gst(base, gst_rate, intrastate)
    total = rupee(base + cgst + sgst + igst)

    if apply_tds:
        tds_section = random.choice(list(TDS_SECTIONS.keys()))
        tds_rate = TDS_SECTIONS[tds_section]
        tds_amount = rupee(base * tds_rate)

    expected_net = rupee(total - (tds_amount or Decimal("0")))

    # Reference number logic
    ref = None
    if case == "9":
        ref = None          # Deliberately missing
    elif case == "10":
        ref = random_utr()[:6]   # Truncated to 6 chars
    else:
        # ~85% have a reference, ~15% don't (naturally)
        if random.random() > 0.15:
            ref = random_utr()

    counterparty_name = random_company_name()

    return Invoice(
        invoice_id=f"INV-{uuid.uuid4().hex[:10].upper()}",
        merchant_id=merchant.merchant_id,
        counterparty_name=counterparty_name,
        counterparty_gstin=random_gstin(counterparty_state) if random.random() > 0.2 else None,
        counterparty_state_code=counterparty_state,
        invoice_date=invoice_date,
        due_date=invoice_date + timedelta(days=random.choice([15, 30, 45, 60])),
        base_amount=base,
        cgst_amount=cgst,
        sgst_amount=sgst,
        igst_amount=igst,
        total_amount=total,
        tds_section=tds_section,
        tds_rate=tds_rate,
        tds_amount=tds_amount,
        expected_net_amount=expected_net,
        reference_number=ref,
        status="open",
    )


def make_txn(
    merchant: Merchant,
    invoice: Invoice,
    txn_date: date,
    amount_override: Optional[Decimal] = None,
    narration_override: Optional[str] = None,
    ref_override: Optional[str] = None,
    direction: str = "credit",
    channel_override: Optional[str] = None,
) -> BankTransaction:
    channel = channel_override or random.choices(
        ["UPI", "NEFT", "IMPS", "RTGS", "cheque"],
        weights=[40, 25, 20, 10, 5],
    )[0]
    ref = ref_override if ref_override is not None else invoice.reference_number
    narration = narration_override or make_narration(
        channel, invoice.counterparty_name, ref
    )
    amount = amount_override if amount_override is not None else invoice.expected_net_amount

    return BankTransaction(
        txn_id=f"TXN-{uuid.uuid4().hex[:10].upper()}",
        merchant_id=merchant.merchant_id,
        txn_date=txn_date,
        value_date=txn_date + timedelta(days=random.choice([0, 0, 0, 1])),
        amount=amount,
        direction=direction,
        channel=channel,
        narration=narration,
        reference_number=ref,
        running_balance=rupee(random.uniform(10_000, 10_00_000)),
    )


# ─────────────────────────────────────────────────────────────────────────────
# Chaos case handlers
# Each returns (list[Invoice], list[BankTransaction], list[GroundTruthLabel])
# ─────────────────────────────────────────────────────────────────────────────

def handle_clean(merchant, inv, base_date, batch_id):
    """Case 'clean' / '1': straightforward 1:1 exact match."""
    txn_date = base_date + timedelta(days=random.randint(0, 7))
    txn = make_txn(merchant, inv, txn_date)
    label = GroundTruthLabel(
        invoice_id=inv.invoice_id, txn_ids=[txn.txn_id],
        is_true_match=True, case_category="clean", batch_id=batch_id,
    )
    return [inv], [txn], [label]


def handle_gst_rounding(merchant, inv, base_date, batch_id):
    """Case 2: Bank pays ±₹1-2 different from expected_net (rounding artifact)."""
    txn_date = base_date + timedelta(days=random.randint(0, 5))
    drift = rupee(random.choice([-2, -1, 1, 2]))
    txn = make_txn(merchant, inv, txn_date, amount_override=inv.expected_net_amount + drift)
    label = GroundTruthLabel(
        invoice_id=inv.invoice_id, txn_ids=[txn.txn_id],
        is_true_match=True, case_category="2", batch_id=batch_id,
    )
    return [inv], [txn], [label]


def handle_tds_adjusted(merchant, inv, base_date, batch_id):
    """Case 3: Payer deducts TDS — expected_net is already correct, but
    generate a second invoice variant where TDS was NOT pre-calculated
    so the raw amount won't match until TDS is applied."""
    # Ensure invoice has TDS applied
    if not inv.tds_amount:
        # Force TDS onto this invoice
        inv.tds_section = "194J"
        inv.tds_rate = TDS_SECTIONS["194J"]
        inv.tds_amount = rupee(inv.base_amount * inv.tds_rate)
        inv.expected_net_amount = rupee(inv.total_amount - inv.tds_amount)

    txn_date = base_date + timedelta(days=random.randint(0, 10))
    # Txn amount = total_amount (payer sent full amount and TDS is handled separately)
    # OR txn amount = expected_net (payer deducted TDS before sending)
    # We use expected_net to test whether the engine handles the TDS math.
    txn = make_txn(merchant, inv, txn_date, amount_override=inv.expected_net_amount)
    label = GroundTruthLabel(
        invoice_id=inv.invoice_id, txn_ids=[txn.txn_id],
        is_true_match=True, case_category="3", batch_id=batch_id,
    )
    return [inv], [txn], [label]


def handle_split(merchant, base_inv, base_date, batch_id):
    """Case 4: One invoice settled by 2-3 separate bank transactions."""
    n_splits = random.randint(2, 3)
    remaining = base_inv.expected_net_amount
    txns = []
    for i in range(n_splits):
        txn_date = base_date + timedelta(days=i * random.randint(1, 5))
        if i < n_splits - 1:
            # Random split — leave at least 10% for last
            pct = Decimal(str(round(random.uniform(0.2, 0.7), 2)))
            part = rupee(base_inv.expected_net_amount * pct)
            part = min(part, remaining - rupee("1"))
        else:
            part = remaining
        remaining -= part
        txn = make_txn(merchant, base_inv, txn_date, amount_override=part)
        txns.append(txn)

    label = GroundTruthLabel(
        invoice_id=base_inv.invoice_id,
        txn_ids=[t.txn_id for t in txns],
        is_true_match=True, case_category="4", batch_id=batch_id,
    )
    return [base_inv], txns, [label]


def handle_batch(merchant, inv, base_date, batch_id):
    """Case 5: One bank transaction settles 2-3 invoices at once (bulk payout)."""
    n_invoices = random.randint(2, 3)
    # Create additional invoices for this batch
    extra_invoices = []
    for _ in range(n_invoices - 1):
        inv_date = base_date - timedelta(days=random.randint(1, 20))
        extra = make_invoice(merchant, inv_date, "clean")
        extra_invoices.append(extra)

    all_invoices = [inv] + extra_invoices
    total_net = sum(i.expected_net_amount for i in all_invoices)

    txn_date = base_date + timedelta(days=random.randint(0, 5))
    # Single txn for the combined amount
    txn = make_txn(merchant, inv, txn_date, amount_override=rupee(total_net))

    labels = [
        GroundTruthLabel(
            invoice_id=i.invoice_id,
            txn_ids=[txn.txn_id],
            is_true_match=True, case_category="5", batch_id=batch_id,
        )
        for i in all_invoices
    ]
    return all_invoices, [txn], labels


def handle_partial(merchant, inv, base_date, batch_id):
    """Case 6: Customer pays only part of the invoice (genuine open balance)."""
    pct = Decimal(str(round(random.uniform(0.3, 0.8), 2)))
    partial_amount = rupee(inv.expected_net_amount * pct)
    txn_date = base_date + timedelta(days=random.randint(0, 10))
    txn = make_txn(merchant, inv, txn_date, amount_override=partial_amount)
    label = GroundTruthLabel(
        invoice_id=inv.invoice_id, txn_ids=[txn.txn_id],
        is_true_match=True, case_category="6", batch_id=batch_id,
    )
    return [inv], [txn], [label]


def handle_partial_refund(merchant, inv, base_date, batch_id):
    """Case 7: Full payment received + partial refund debit entry."""
    txn_date = base_date + timedelta(days=random.randint(0, 5))
    credit_txn = make_txn(merchant, inv, txn_date)  # Full payment
    refund_pct = Decimal(str(round(random.uniform(0.1, 0.4), 2)))
    refund_amount = rupee(inv.expected_net_amount * refund_pct)
    refund_date = txn_date + timedelta(days=random.randint(1, 10))
    debit_txn = make_txn(
        merchant, inv, refund_date,
        amount_override=refund_amount,
        direction="debit",
        narration_override=f"REFUND/{abbrev(inv.counterparty_name)}/{credit_txn.txn_id[-6:]}",
    )
    label = GroundTruthLabel(
        invoice_id=inv.invoice_id,
        txn_ids=[credit_txn.txn_id, debit_txn.txn_id],
        is_true_match=True, case_category="7", batch_id=batch_id,
    )
    return [inv], [credit_txn, debit_txn], [label]


def handle_near_duplicate(merchant, inv, base_date, batch_id):
    """Case 8: Another invoice with very similar amount + similar counterparty name.
    The engine must NOT confuse the two."""
    # Create a decoy invoice with similar (within ₹50) amount and similar name
    decoy_inv = make_invoice(merchant, base_date - timedelta(days=5), "clean")
    decoy_inv.counterparty_name = inv.counterparty_name[:6] + random_company_name()[:6]
    decoy_inv.expected_net_amount = rupee(
        inv.expected_net_amount + Decimal(str(random.randint(-50, 50)))
    )
    decoy_inv.base_amount = decoy_inv.expected_net_amount

    # Real txn for the real invoice
    txn_date = base_date + timedelta(days=random.randint(0, 5))
    txn = make_txn(merchant, inv, txn_date)
    label_real = GroundTruthLabel(
        invoice_id=inv.invoice_id, txn_ids=[txn.txn_id],
        is_true_match=True, case_category="8", batch_id=batch_id,
    )
    # Decoy invoice is unpaid (no txn)
    label_decoy = GroundTruthLabel(
        invoice_id=decoy_inv.invoice_id, txn_ids=[],
        is_true_match=False, case_category="13", batch_id=batch_id,
    )
    return [inv, decoy_inv], [txn], [label_real, label_decoy]


def handle_missing_ref(merchant, inv, base_date, batch_id):
    """Case 9: Reference number is None on both sides — match must happen via amount+name."""
    inv.reference_number = None
    txn_date = base_date + timedelta(days=random.randint(0, 7))
    txn = make_txn(merchant, inv, txn_date, ref_override=None)
    txn.reference_number = None
    label = GroundTruthLabel(
        invoice_id=inv.invoice_id, txn_ids=[txn.txn_id],
        is_true_match=True, case_category="9", batch_id=batch_id,
    )
    return [inv], [txn], [label]


def handle_truncated_ref(merchant, inv, base_date, batch_id):
    """Case 10: Reference truncated in narration — only first 6 chars survive."""
    full_ref = random_utr()
    inv.reference_number = full_ref
    txn_date = base_date + timedelta(days=random.randint(0, 5))
    truncated = full_ref[:6]
    narration = make_narration("NEFT", inv.counterparty_name, truncated)
    txn = make_txn(
        merchant, inv, txn_date,
        narration_override=narration,
        ref_override=truncated,
    )
    txn.reference_number = truncated
    label = GroundTruthLabel(
        invoice_id=inv.invoice_id, txn_ids=[txn.txn_id],
        is_true_match=True, case_category="10", batch_id=batch_id,
    )
    return [inv], [txn], [label]


def handle_date_lag(merchant, inv, base_date, batch_id):
    """Case 11: Payment arrives 45-60 days after invoice date."""
    lag_days = random.randint(45, 60)
    txn_date = base_date + timedelta(days=lag_days)
    txn = make_txn(merchant, inv, txn_date)
    label = GroundTruthLabel(
        invoice_id=inv.invoice_id, txn_ids=[txn.txn_id],
        is_true_match=True, case_category="11", batch_id=batch_id,
    )
    return [inv], [txn], [label]


def handle_orphan_txn(merchant, inv, base_date, batch_id):
    """Case 12: A bank credit for which NO invoice exists."""
    txn_date = base_date + timedelta(days=random.randint(0, 10))
    txn = make_txn(merchant, inv, txn_date)
    # inv is NOT included in returned invoices — no invoice counterpart
    label = GroundTruthLabel(
        invoice_id="ORPHAN_NO_INVOICE",
        txn_ids=[txn.txn_id],
        is_true_match=False, case_category="12", batch_id=batch_id,
    )
    return [], [txn], [label]   # ← no invoice returned


def handle_unpaid(merchant, inv, base_date, batch_id):
    """Case 13: An invoice with NO corresponding bank transaction."""
    label = GroundTruthLabel(
        invoice_id=inv.invoice_id, txn_ids=[],
        is_true_match=False, case_category="13", batch_id=batch_id,
    )
    return [inv], [], [label]


def handle_name_mismatch(merchant, inv, base_date, batch_id):
    """Case 14: Narration uses an abbreviation or alias that doesn't textually
    match the invoice counterparty name."""
    txn_date = base_date + timedelta(days=random.randint(0, 7))
    # Use a completely different-looking abbreviation
    mangled = abbrev(inv.counterparty_name)[:3] + "XXX"
    narration = make_narration("UPI", mangled, inv.reference_number)
    txn = make_txn(merchant, inv, txn_date, narration_override=narration)
    label = GroundTruthLabel(
        invoice_id=inv.invoice_id, txn_ids=[txn.txn_id],
        is_true_match=True, case_category="14", batch_id=batch_id,
    )
    return [inv], [txn], [label]


def handle_duplicate_txn(merchant, inv, base_date, batch_id):
    """Case 15: Bank posts the same transaction twice (bank-side error).
    Engine must flag as duplicate and count only one."""
    txn_date = base_date + timedelta(days=random.randint(0, 5))
    txn1 = make_txn(merchant, inv, txn_date)
    # Duplicate: same amount, same narration, next business day
    txn2 = make_txn(
        merchant, inv,
        txn_date + timedelta(days=1),
        amount_override=txn1.amount,
        narration_override=txn1.narration,
        ref_override=txn1.reference_number,
    )
    label = GroundTruthLabel(
        invoice_id=inv.invoice_id,
        txn_ids=[txn1.txn_id, txn2.txn_id],
        is_true_match=True, case_category="15", batch_id=batch_id,
    )
    return [inv], [txn1, txn2], [label]


CASE_HANDLERS = {
    "clean": handle_clean,
    "1":     handle_clean,
    "2":     handle_gst_rounding,
    "3":     handle_tds_adjusted,
    "4":     handle_split,
    "5":     handle_batch,
    "6":     handle_partial,
    "7":     handle_partial_refund,
    "8":     handle_near_duplicate,
    "9":     handle_missing_ref,
    "10":    handle_truncated_ref,
    "11":    handle_date_lag,
    "12":    handle_orphan_txn,
    "13":    handle_unpaid,
    "14":    handle_name_mismatch,
    "15":    handle_duplicate_txn,
}


# ─────────────────────────────────────────────────────────────────────────────
# Main generation logic
# ─────────────────────────────────────────────────────────────────────────────

async def generate(
    n_merchants: int = 3,
    invoices_per_merchant: int = 30,
    batch_id: Optional[str] = None,
    clear_existing: bool = True,
) -> dict:
    """
    Generate synthetic data and persist to MongoDB Atlas.

    Returns a summary dict with counts of each document type created.
    """
    settings = get_settings()
    client = motor.motor_asyncio.AsyncIOMotorClient(settings.mongodb_uri)
    await init_beanie(
        database=client[settings.mongodb_db_name],
        document_models=[
            Merchant, Invoice, BankTransaction,
            Match, AuditLogEntry, GroundTruthLabel,
        ],
    )

    if clear_existing:
        log.info("Clearing existing data from all collections…")
        await Merchant.delete_all()
        await Invoice.delete_all()
        await BankTransaction.delete_all()
        await Match.delete_all()
        await AuditLogEntry.delete_all()
        await GroundTruthLabel.delete_all()

    batch_id = batch_id or f"BATCH-{uuid.uuid4().hex[:8].upper()}"
    log.info(f"Generating batch {batch_id} — {n_merchants} merchants × {invoices_per_merchant} invoices")

    all_merchants = []
    all_invoices = []
    all_txns = []
    all_labels = []

    for m_idx in range(n_merchants):
        merchant = make_merchant()
        all_merchants.append(merchant)
        log.info(f"  Merchant {m_idx+1}/{n_merchants}: {merchant.name} ({merchant.merchant_id})")

        # Assign chaos cases to invoices
        cases = random.choices(CASE_POPULATION, weights=CASE_WEIGHTS_LIST, k=invoices_per_merchant)

        for case in cases:
            # Base invoice date: somewhere in the last 6 months
            inv_date = date.today() - timedelta(days=random.randint(1, 180))
            inv = make_invoice(merchant, inv_date, case)
            handler = CASE_HANDLERS[case]
            invoices, txns, labels = handler(merchant, inv, inv_date, batch_id)
            all_invoices.extend(invoices)
            all_txns.extend(txns)
            all_labels.extend(labels)

    # Persist in bulk
    log.info(f"Inserting {len(all_merchants)} merchants…")
    await Merchant.insert_many(all_merchants)

    log.info(f"Inserting {len(all_invoices)} invoices…")
    if all_invoices:
        await Invoice.insert_many(all_invoices)

    log.info(f"Inserting {len(all_txns)} bank transactions…")
    if all_txns:
        await BankTransaction.insert_many(all_txns)

    log.info(f"Inserting {len(all_labels)} ground-truth labels…")
    if all_labels:
        await GroundTruthLabel.insert_many(all_labels)

    summary = {
        "batch_id": batch_id,
        "merchants": len(all_merchants),
        "invoices": len(all_invoices),
        "bank_transactions": len(all_txns),
        "ground_truth_labels": len(all_labels),
    }
    log.info(f"Done. Summary: {summary}")
    return summary


# ─────────────────────────────────────────────────────────────────────────────
# CLI entry point
# ─────────────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Generate synthetic ReconAI dataset")
    parser.add_argument("--merchants", type=int, default=3, help="Number of merchants (default: 3)")
    parser.add_argument("--invoices-per-merchant", type=int, default=30, help="Invoices per merchant (default: 30)")
    parser.add_argument("--batch-id", type=str, default=None, help="Custom batch ID")
    parser.add_argument("--no-clear", action="store_true", help="Don't clear existing data before generating")
    args = parser.parse_args()

    summary = asyncio.run(generate(
        n_merchants=args.merchants,
        invoices_per_merchant=args.invoices_per_merchant,
        batch_id=args.batch_id,
        clear_existing=not args.no_clear,
    ))
    print("\n✅ Generation complete:")
    for k, v in summary.items():
        print(f"   {k:30s} {v}")


if __name__ == "__main__":
    main()
