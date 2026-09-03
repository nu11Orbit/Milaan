"""
generate_synthetic_data.py
===========================
Generates the complete synthetic evaluation dataset for Milaan / ReconAI
per the build plan's chaos-injection catalog (Section 5.3 & 5.4).

Outputs 3 linked CSV files with a fixed random seed (42) for 100% reproducibility:
  1. bank_statement.csv
  2. invoice_register.csv
  3. ground_truth.csv

Target mix: ~70 total records distributed across:
  - ~40%: exact 1:1 matches (clean amount + reference number) [Case 1]
  - ~10%: GST rounding drift (±₹1-2 noise on bank amount) [Case 2]
  - ~10%: TDS-adjusted settlements (194J 10%, 194C 2%), no ref in narration [Case 3]
  - ~8%: split settlements (1 invoice paid via 2-3 transactions) [Case 4]
  - ~6%: batched payouts (multiple invoices settled via 1 lump transfer) [Case 5]
  - ~6%: genuine partial payments (never fully settled — stays open) [Case 6]
  - ~5%: partial refunds (debit reversing part of earlier credit) [Case 7]
  - ~5%: near-duplicate confusion (two invoices within ₹50 with similar names) [Case 8]
  - ~6%: genuine orphan bank transactions (interest credits, vendor refunds) [Case 12]
  - ~5%: genuine unpaid invoices (no bank transaction) [Case 13]
  - Overlaid with Cases 9, 10, 11, 14, 15 and same-day same-amount collision stress tests.

Usage:
  python data/generate_synthetic_data.py --out-dir ../test_data/evaluation_batch
"""

from __future__ import annotations

import argparse
import csv
import os
import random
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP
from typing import Dict, List, Optional, Tuple

from faker import Faker

# Fixed seed for 100% deterministic reproducibility
SEED = 42
random.seed(SEED)
fake = Faker("en_IN")
Faker.seed(SEED)

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

TDS_RATES = {
    "194J": Decimal("0.10"),  # Professional / Technical services (10%)
    "194C": Decimal("0.02"),  # Contractor payments (2%)
    "194I": Decimal("0.10"),  # Rent (10%)
    "194Q": Decimal("0.001"), # Purchase of goods (0.1%)
}

GST_SLABS = [Decimal("0"), Decimal("5"), Decimal("12"), Decimal("18"), Decimal("28")]


def rupee(val: float | int | str | Decimal) -> Decimal:
    """Quantize to 2 decimal places using standard banking round-half-up."""
    return Decimal(str(val)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def format_date(d: date) -> str:
    """Format as DD-MM-YYYY."""
    return d.strftime("%d-%m-%Y")


def random_company_name() -> str:
    suffixes = ["Pvt Ltd", "Enterprises", "Trading Co", "Logistics", "Technologies", "Suppliers", "Associates", "Industries"]
    first = fake.unique.company() if hasattr(fake, "unique") else fake.company()
    # Clean up company names
    first = first.replace("and Sons", "").replace("Group", "").replace("LLC", "").replace("Inc", "").strip()
    return f"{first} {random.choice(suffixes)}"


def random_utr(seq: int) -> str:
    """Generate realistic UTR string."""
    return f"UTR202608{seq:05d}"


def compute_gst(base: Decimal, gst_rate: Decimal, intrastate: bool) -> Tuple[Decimal, Decimal, Decimal]:
    """Return (cgst, sgst, igst)."""
    total_gst = rupee(base * gst_rate / 100)
    if intrastate:
        half = rupee(total_gst / 2)
        return half, half, Decimal("0")
    else:
        return Decimal("0"), Decimal("0"), total_gst


class SyntheticDatasetBuilder:
    def __init__(self, merchant_state: str = "27", base_date: date = date(2026, 8, 1), seed: int = 42):
        self.merchant_state = merchant_state
        self.base_date = base_date
        self.seed = seed
        random.seed(seed)
        Faker.seed(seed)
        global fake
        fake = Faker("en_IN")
        fake.seed_instance(seed)
        self.invoices: List[Dict] = []
        self.txns: List[Dict] = []
        self.ground_truth: List[Dict] = []

        self._inv_seq = 1
        self._txn_seq = 1

    def next_inv_id(self) -> str:
        inv_id = f"INV-{self._inv_seq:03d}"
        self._inv_seq += 1
        return inv_id

    def next_txn_id(self) -> str:
        txn_id = f"TXN-{self._txn_seq:03d}"
        self._txn_seq += 1
        return txn_id

    def build_invoice(
        self,
        counterparty: str,
        base_amt: Decimal,
        gst_rate: Decimal = Decimal("18"),
        tds_section: Optional[str] = None,
        days_offset: int = 0,
        ref_number: Optional[str] = None,
        intrastate: Optional[bool] = None,
    ) -> Dict:
        inv_id = self.next_inv_id()
        inv_date = self.base_date + timedelta(days=days_offset)

        if intrastate is None:
            intrastate = (random.random() < 0.6)  # 60% intrastate

        cgst, sgst, igst = compute_gst(base_amt, gst_rate, intrastate)
        total_amt = rupee(base_amt + cgst + sgst + igst)

        tds_amt = Decimal("0")
        if tds_section:
            rate = TDS_RATES.get(tds_section, Decimal("0.10"))
            tds_amt = rupee(base_amt * rate)

        net_amt = rupee(total_amt - tds_amt)

        inv = {
            "invoice_id": inv_id,
            "invoice_date": format_date(inv_date),
            "_date_obj": inv_date,
            "counterparty_name": counterparty,
            "base_amount": int(base_amt) if base_amt == int(base_amt) else str(base_amt),
            "total_amount": int(total_amt) if total_amt == int(total_amt) else str(total_amt),
            "cgst_amount": str(cgst),
            "sgst_amount": str(sgst),
            "igst_amount": str(igst),
            "tds_section": tds_section or "",
            "tds_amount": int(tds_amt) if tds_amt == int(tds_amt) else str(tds_amt),
            "expected_net_amount": int(net_amt) if net_amt == int(net_amt) else str(net_amt),
            "reference_number": ref_number or "",
            "status": "open",
            "_net_decimal": net_amt,
            "_total_decimal": total_amt,
        }
        self.invoices.append(inv)
        return inv

    def build_txn(
        self,
        amount: Decimal,
        narration: str,
        days_offset: int,
        direction: str = "credit",
        channel: str = "NEFT",
        ref_number: Optional[str] = None,
    ) -> Dict:
        txn_id = self.next_txn_id()
        txn_date = self.base_date + timedelta(days=days_offset)
        ref = ref_number if ref_number is not None else random_utr(self._txn_seq)

        txn = {
            "txn_id": txn_id,
            "txn_date": format_date(txn_date),
            "_date_obj": txn_date,
            "amount": int(amount) if amount == int(amount) else str(amount),
            "direction": direction,
            "narration": narration,
            "channel": channel,
            "reference_number": ref,
            "_amount_decimal": amount,
        }
        self.txns.append(txn)
        return txn

    def add_gt(self, invoice_id: str, txn_ids: List[str], is_true: bool, category: str):
        self.ground_truth.append({
            "invoice_id": invoice_id,
            "txn_ids": ",".join(txn_ids),
            "is_true_match": "true" if is_true else "false",
            "case_category": category,
        })

    def generate_all(self):
        """Generate full ~70-record dataset matching all chaos cases."""

        # ── 1. EXACT 1:1 MATCHES (~40% -> 26 records) [Case 1] ───────────────
        clean_amounts = [
            Decimal("15000"), Decimal("24500"), Decimal("38000"), Decimal("52000"),
            Decimal("65000"), Decimal("82000"), Decimal("95000"), Decimal("110000"),
            Decimal("125000"), Decimal("140000"), Decimal("175000"), Decimal("190000"),
            Decimal("210000"), Decimal("240000"), Decimal("275000"), Decimal("310000"),
            Decimal("340000"), Decimal("380000"), Decimal("420000"), Decimal("460000"),
            Decimal("490000"), Decimal("55000"), Decimal("72000"), Decimal("135000"),
            Decimal("160000"), Decimal("225000")
        ]

        for i, base in enumerate(clean_amounts):
            cname = random_company_name()
            inv_ref = random_utr(100 + i)
            inv = self.build_invoice(cname, base, gst_rate=Decimal("18"), days_offset=i, ref_number=inv_ref)

            channel = random.choice(["NEFT", "RTGS", "IMPS", "UPI"])
            net = inv["_net_decimal"]
            txn_ref = inv_ref
            narr_ref = inv_ref

            if i % 7 == 0:  # Case 14 overlay: abbreviated name
                short_name = "".join([w[:4] for w in cname.split()[:2]]).upper()
                narr = f"{channel}/{short_name} settlement {narr_ref}"
                cat = "14"
            elif i % 5 == 0:  # Case 9 overlay: missing ref
                txn_ref = ""
                narr = f"{channel} payout from {cname.upper()} invoice settlement"
                cat = "9"
            elif i % 8 == 0:  # Case 10 overlay: truncated ref
                txn_ref = inv_ref[:6]
                narr = f"{channel}-{inv_ref[:6]}-{cname.upper()}"
                cat = "10"
            else:
                narr = f"{channel} payment {cname.upper()} {narr_ref} settled"
                cat = "1"

            txn = self.build_txn(net, narr, days_offset=i + random.randint(1, 4), channel=channel, ref_number=txn_ref)
            self.add_gt(inv["invoice_id"], [txn["txn_id"]], True, cat)

        # ── 2. GST ROUNDING DRIFT (~10% -> 7 records) [Case 2] ───────────────
        gst_bases = [
            Decimal("18350"), Decimal("34120"), Decimal("67890"),
            Decimal("91450"), Decimal("145320"), Decimal("212450"), Decimal("389100")
        ]
        drifts = [Decimal("1"), Decimal("-1"), Decimal("2"), Decimal("-2"), Decimal("1"), Decimal("-1"), Decimal("2")]
        for i, (base, drift) in enumerate(zip(gst_bases, drifts)):
            cname = random_company_name()
            ref = random_utr(200 + i)
            inv = self.build_invoice(cname, base, gst_rate=Decimal("18"), days_offset=5 + i, ref_number=ref)
            bank_amt = rupee(inv["_net_decimal"] + drift)
            narr = f"NEFT payment from {cname.upper()} ref {ref} net settled"
            txn = self.build_txn(bank_amt, narr, days_offset=7 + i, channel="NEFT", ref_number=ref)
            self.add_gt(inv["invoice_id"], [txn["txn_id"]], True, "2")

        # ── 3. TDS-ADJUSTED SETTLEMENTS (~10% -> 7 records) [Case 3] ─────────
        tds_configs = [
            (Decimal("100000"), "194J"),  # Base 100k -> 118k total - 10k TDS = 108k net
            (Decimal("50000"), "194J"),   # 50k base
            (Decimal("85000"), "194C"),   # 85k base -> 2% TDS
            (Decimal("150000"), "194J"),  # 150k base -> 10% TDS
            (Decimal("200000"), "194C"),  # 200k base -> 2% TDS
            (Decimal("75000"), "194J"),   # 75k base -> 10% TDS
            (Decimal("120000"), "194C"),  # 120k base -> 2% TDS
        ]
        for i, (base, sec) in enumerate(tds_configs):
            cname = random_company_name()
            inv = self.build_invoice(cname, base, gst_rate=Decimal("18"), tds_section=sec, days_offset=10 + i, ref_number="")
            net = inv["_net_decimal"]
            narr = f"RTGS from {cname.upper()} {sec} TDS deducted payment"
            txn = self.build_txn(net, narr, days_offset=12 + i, channel="RTGS", ref_number="")
            self.add_gt(inv["invoice_id"], [txn["txn_id"]], True, "3")

        # ── 4. SPLIT SETTLEMENTS (~8% -> 5 invoices / 11 txns) [Case 4] ──────
        split_cases = [
            (Decimal("60000"), [Decimal("20000"), Decimal("40000")]),
            (Decimal("90000"), [Decimal("30000"), Decimal("30000"), Decimal("30000")]),
            (Decimal("150000"), [Decimal("75000"), Decimal("75000")]),
            (Decimal("80000"), [Decimal("35000"), Decimal("45000")]),
            (Decimal("120000"), [Decimal("40000"), Decimal("80000")]),
        ]
        for i, (base, parts) in enumerate(split_cases):
            cname = random_company_name()
            inv = self.build_invoice(cname, base, gst_rate=Decimal("0"), days_offset=15 + i)
            split_txns = []
            for p_idx, part_amt in enumerate(parts):
                part_label = "first" if p_idx == 0 else ("second" if p_idx == 1 else "final")
                narr = f"NEFT Part payment {cname.upper()} {inv['invoice_id']} {part_label} installment"
                t = self.build_txn(part_amt, narr, days_offset=16 + i + p_idx * 2, channel="NEFT")
                split_txns.append(t["txn_id"])
            self.add_gt(inv["invoice_id"], split_txns, True, "4")

        # ── 5. BATCHED PAYOUTS (~6% -> 4 batch transactions, 9 invoices) [Case 5] ──
        batch_configs = [
            (random_company_name(), [Decimal("45000"), Decimal("55000")]),
            (random_company_name(), [Decimal("30000"), Decimal("40000"), Decimal("50000")]),
            (random_company_name(), [Decimal("60000"), Decimal("85000")]),
            (random_company_name(), [Decimal("70000"), Decimal("80000")]),
        ]
        for i, (cname, inv_bases) in enumerate(batch_configs):
            batch_inv_ids = []
            total_batch_amt = Decimal("0")
            for b_idx, b_amt in enumerate(inv_bases):
                inv = self.build_invoice(cname, b_amt, gst_rate=Decimal("0"), days_offset=18 + i + b_idx)
                batch_inv_ids.append(inv["invoice_id"])
                total_batch_amt += inv["_net_decimal"]

            inv_str = " ".join(batch_inv_ids)
            narr = f"RTGS Batch payout {cname.upper()} {inv_str}"
            txn = self.build_txn(total_batch_amt, narr, days_offset=22 + i, channel="RTGS")

            for i_id in batch_inv_ids:
                self.add_gt(i_id, [txn["txn_id"]], True, "5")

        # ── 6. GENUINE PARTIAL PAYMENTS (~6% -> 4 records) [Case 6] ──────────
        partial_cases = [
            (Decimal("75000"), Decimal("35000")),
            (Decimal("110000"), Decimal("50000")),
            (Decimal("160000"), Decimal("80000")),
            (Decimal("95000"), Decimal("45000")),
        ]
        for i, (base, paid_amt) in enumerate(partial_cases):
            cname = random_company_name()
            inv = self.build_invoice(cname, base, gst_rate=Decimal("0"), days_offset=20 + i)
            narr = f"IMPS Partial advance payment {cname.upper()} on {inv['invoice_id']}"
            txn = self.build_txn(paid_amt, narr, days_offset=22 + i, channel="IMPS")
            self.add_gt(inv["invoice_id"], [txn["txn_id"]], True, "6")

        # ── 7. PARTIAL REFUNDS / DEBITS (~5% -> 3 records) [Case 7] ──────────
        refund_cases = [
            (Decimal("50000"), Decimal("15000")),
            (Decimal("80000"), Decimal("20000")),
            (Decimal("120000"), Decimal("30000")),
        ]
        for i, (full_amt, ref_amt) in enumerate(refund_cases):
            cname = random_company_name()
            inv = self.build_invoice(cname, full_amt, gst_rate=Decimal("0"), days_offset=22 + i)
            t_credit = self.build_txn(full_amt, f"NEFT payment from {cname.upper()} {inv['invoice_id']}", days_offset=24 + i)
            t_debit = self.build_txn(ref_amt, f"Refund issued to {cname.upper()}", days_offset=28 + i, direction="debit")
            # The credit transaction settles the invoice (Case 7 true match)
            self.add_gt(inv["invoice_id"], [t_credit["txn_id"]], True, "7")
            # The debit transaction is an unattached refund exception
            self.add_gt(f"REFUND_{t_debit['txn_id']}", [t_debit["txn_id"]], False, "7")

        # ── 8. NEAR-DUPLICATE CONFUSION (~5% -> 4 invoices, 2 txns) [Case 8] ──
        name_a1 = "Arora Logistics Solutions"
        name_a2 = "Arora Transporters India"
        inv_a1 = self.build_invoice(name_a1, Decimal("48500"), gst_rate=Decimal("0"), days_offset=25)
        inv_a2 = self.build_invoice(name_a2, Decimal("48525"), gst_rate=Decimal("0"), days_offset=25)
        txn_a1 = self.build_txn(Decimal("48500"), f"NEFT payment {name_a1.upper()} settlement", days_offset=27)
        self.add_gt(inv_a1["invoice_id"], [txn_a1["txn_id"]], True, "8")
        self.add_gt(inv_a2["invoice_id"], [], False, "13")  # Decoy unpaid

        name_b1 = "Singhal Software Tech"
        name_b2 = "Singhal Infotech Systems"
        inv_b1 = self.build_invoice(name_b1, Decimal("92000"), gst_rate=Decimal("0"), days_offset=26)
        inv_b2 = self.build_invoice(name_b2, Decimal("92030"), gst_rate=Decimal("0"), days_offset=26)
        txn_b1 = self.build_txn(Decimal("92000"), f"RTGS {name_b1.upper()} payment", days_offset=28)
        self.add_gt(inv_b1["invoice_id"], [txn_b1["txn_id"]], True, "8")
        self.add_gt(inv_b2["invoice_id"], [], False, "13")

        # ── 9. SAME-DAY, SAME-AMOUNT COLLISION STRESS TEST (Hungarian demotion test) ──
        c_col1 = "Pooja Textiles Ltd"
        c_col2 = "Karan Enterprises"
        inv_col1 = self.build_invoice(c_col1, Decimal("75000"), gst_rate=Decimal("0"), days_offset=28)
        inv_col2 = self.build_invoice(c_col2, Decimal("75000"), gst_rate=Decimal("0"), days_offset=28)
        txn_col1 = self.build_txn(Decimal("75000"), f"NEFT {c_col1.upper()} payment", days_offset=29)
        self.add_gt(inv_col1["invoice_id"], [txn_col1["txn_id"]], True, "1")
        self.add_gt(inv_col2["invoice_id"], [], False, "13")

        # ── 10. DATE LAG OUTLIER (~4% -> 3 records) [Case 11] ────────────────
        lag_bases = [Decimal("42000"), Decimal("88000"), Decimal("130000")]
        for i, base in enumerate(lag_bases):
            cname = random_company_name()
            ref = random_utr(500 + i)
            inv = self.build_invoice(cname, base, gst_rate=Decimal("18"), days_offset=1 + i, ref_number=ref)
            txn = self.build_txn(inv["_net_decimal"], f"NEFT delayed settlement {cname.upper()} {ref}", days_offset=54 + i, ref_number=ref)
            self.add_gt(inv["invoice_id"], [txn["txn_id"]], True, "11")

        # ── 11. GENUINE ORPHAN BANK TRANSACTIONS (~6% -> 4 records) [Case 12] ─
        orphan_configs = [
            (Decimal("15"), "Bank interest credit Q2", "NEFT"),
            (Decimal("50"), "Savings account interest credit", "NEFT"),
            (Decimal("25000"), "Unidentified deposit from unknown party", "IMPS"),
            (Decimal("99999"), "Direct transfer without billing ref", "RTGS"),
        ]
        for i, (amt, narr, ch) in enumerate(orphan_configs):
            t = self.build_txn(amt, narr, days_offset=30 + i, channel=ch, ref_number="")
            self.add_gt(f"ORPHAN_{t['txn_id']}", [t["txn_id"]], False, "12")

        # ── 12. GENUINE UNPAID INVOICES (~5% -> 4 records) [Case 13] ─────────
        unpaid_bases = [Decimal("32000"), Decimal("64000"), Decimal("115000"), Decimal("280000")]
        for i, base in enumerate(unpaid_bases):
            cname = random_company_name()
            inv = self.build_invoice(cname, base, gst_rate=Decimal("18"), days_offset=2 + i)
            self.add_gt(inv["invoice_id"], [], False, "13")

        # ── 13. BANK DUPLICATE TRANSACTION (~2% -> 1 pair) [Case 15] ─────────
        dup_cname = "Oberoi Logistics Group"
        inv_dup = self.build_invoice(dup_cname, Decimal("68000"), gst_rate=Decimal("0"), days_offset=24)
        t_orig = self.build_txn(Decimal("68000"), f"NEFT payment from {dup_cname.upper()}", days_offset=25)
        t_dup = self.build_txn(Decimal("68000"), f"NEFT payment from {dup_cname.upper()}", days_offset=26)
        self.add_gt(inv_dup["invoice_id"], [t_orig["txn_id"], t_dup["txn_id"]], True, "15")

    def export_csvs(self, out_dir: str):
        os.makedirs(out_dir, exist_ok=True)

        # 1. bank_statement.csv
        bank_path = os.path.join(out_dir, "bank_statement.csv")
        bank_fields = ["txn_id", "txn_date", "amount", "direction", "narration", "channel", "reference_number"]
        with open(bank_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=bank_fields)
            writer.writeheader()
            for t in self.txns:
                row = {k: t[k] for k in bank_fields}
                writer.writerow(row)

        # 2. invoice_register.csv
        inv_path = os.path.join(out_dir, "invoice_register.csv")
        inv_fields = [
            "invoice_id", "invoice_date", "counterparty_name", "base_amount",
            "total_amount", "tds_section", "tds_amount", "expected_net_amount", "status"
        ]
        with open(inv_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=inv_fields)
            writer.writeheader()
            for inv in self.invoices:
                row = {k: inv[k] for k in inv_fields}
                writer.writerow(row)

        # 3. ground_truth.csv
        gt_path = os.path.join(out_dir, "ground_truth.csv")
        gt_fields = ["invoice_id", "txn_ids", "is_true_match", "case_category"]
        with open(gt_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=gt_fields)
            writer.writeheader()
            for gt in self.ground_truth:
                writer.writerow(gt)

        print(f"✅ Generated dataset successfully saved to: {out_dir}")
        print(f"   • {len(self.txns)} bank transactions in bank_statement.csv")
        print(f"   • {len(self.invoices)} invoices in invoice_register.csv")
        print(f"   • {len(self.ground_truth)} ground truth labels in ground_truth.csv")


def main():
    parser = argparse.ArgumentParser(description="Generate synthetic ReconAI evaluation dataset")
    parser.add_argument("--out-dir", type=str, default="../test_data/evaluation_batch", help="Output directory for CSV files")
    parser.add_argument("--seed", type=int, default=42, help="Random seed for deterministic generation")
    args = parser.parse_args()

    builder = SyntheticDatasetBuilder(seed=args.seed)
    builder.generate_all()
    builder.export_csvs(args.out_dir)


if __name__ == "__main__":
    main()
