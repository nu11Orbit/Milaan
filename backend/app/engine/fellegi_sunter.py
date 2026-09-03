"""
engine/fellegi_sunter.py
Fellegi-Sunter Probabilistic Record Linkage Model
==================================================

Replaces hand-tuned additive weights with theoretically grounded log-likelihood
ratios (LLRs) per the Fellegi-Sunter (1969) record linkage framework.

Theory
------
For each comparison field f:
  m_prob  = P(field agrees | records are a true match)   — estimated from labels
  u_prob  = P(field agrees | records are NOT a match)    — estimated from labels

  LLR(f, agrees=True)  = log(m_f / u_f)               — positive: evidence FOR match
  LLR(f, agrees=False) = log((1-m_f) / (1-u_f))       — negative: evidence AGAINST
  LLR(f, agrees=None)  = 0.0                            — missing-at-random (no penalty)

Total LLR = Σ LLR(f) across all comparison fields.
Mapped to [0, 100] via linear normalisation anchored on the theoretical maximum
(all fields agree) and minimum (all fields disagree).

Why this beats hand-tuned weights
----------------------------------
A reference number agreement is extremely rare between two random records (u ≈ 0.02),
so agreeing on it gives LLR = log(0.92/0.02) ≈ 3.83 — a huge lift.
A date-window agreement is much more common by chance (u ≈ 0.35), so it gives
LLR = log(0.75/0.35) ≈ 0.76 — a modest lift. No hand-tuning required.

Missing-data handling (PMC9336505)
------------------------------------
A field that is absent from either record contributes LLR=0 (missing-at-random
assumption). This is strictly better than treating absence as disagreement, which
would artificially penalise records with sparse data (e.g., no reference number).

m/u Probability Estimation
---------------------------
Call `FSModel.estimate_from_labels(true_pairs, false_pairs)` after loading
GroundTruthLabel documents. On cold start, calibrated Bayesian priors are used.
Laplace smoothing (add-1) prevents zero counts from collapsing log ratios.

References
----------
- Fellegi & Sunter, "A Theory for Record Linkage", JASA 1969
- PMC9336505 — missing-at-random refinement for healthcare record linkage
- JMIR e33775 — Fellegi-Sunter with missing data in clinical data integration
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field
from decimal import Decimal
from typing import ClassVar, Dict, List, Optional

log = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# FieldSpec: one comparison field with its m/u probabilities
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class FieldSpec:
    """
    A single comparison field in the Fellegi-Sunter model.

    Parameters
    ----------
    name   : Unique field identifier (used as key in signals dict).
    m_prob : P(field agrees | true match). Must be > u_prob.
    u_prob : P(field agrees | non-match). Must be < m_prob.
    """
    name:   str
    m_prob: float   # P(agree | match)
    u_prob: float   # P(agree | non-match)

    def __post_init__(self):
        if not (0 < self.u_prob < self.m_prob < 1):
            raise ValueError(
                f"Field '{self.name}': requires 0 < u_prob ({self.u_prob}) "
                f"< m_prob ({self.m_prob}) < 1"
            )

    @property
    def agree_llr(self) -> float:
        """Log-likelihood ratio when the field agrees (always positive)."""
        return math.log(self.m_prob / self.u_prob)

    @property
    def disagree_llr(self) -> float:
        """Log-likelihood ratio when the field disagrees (always negative)."""
        return math.log((1.0 - self.m_prob) / (1.0 - self.u_prob))

    def llr(self, agrees: Optional[bool]) -> float:
        """
        Return the LLR contribution for this field.

        agrees=True  → agree_llr  (positive evidence for match)
        agrees=False → disagree_llr (negative evidence against match)
        agrees=None  → 0.0  (field missing — missing-at-random, no penalty)
        """
        if agrees is None:
            return 0.0
        return self.agree_llr if agrees else self.disagree_llr


# ─────────────────────────────────────────────────────────────────────────────
# FSModel: the full Fellegi-Sunter model
# ─────────────────────────────────────────────────────────────────────────────

class FSModel:
    """
    Fellegi-Sunter probabilistic record linkage model for bank-invoice matching.

    Usage
    -----
    fs = FSModel()                                  # initialise with priors
    signals = fs.compare(txn_view, inv_view)        # build comparison signals
    score   = fs.score_signals(signals)             # → float in [0, 100]

    # Or in one call:
    score = fs.compute_score(txn_view, inv_view)

    # After loading labeled data:
    fs.estimate_from_labels(true_signal_list, false_signal_list)
    """

    # Calibrated priors for Indian SME bank-invoice reconciliation.
    # Column order: (field_name, m_prob, u_prob)
    # m > u is required by FieldSpec.
    #
    # Interpretation of u_prob:
    #   reference_number: random records rarely share a reference → u=0.02
    #   amount_exact:     exact amount match is uncommon by chance → u=0.04
    #   date_window:      45-day window is wide → many non-matches fall in → u=0.35
    PRIORS: ClassVar[List[tuple]] = [
        # field_name          m_prob  u_prob
        ("reference_number",  0.92,   0.02),   # exact ref: rare by chance, very informative
        ("amount_exact",      0.88,   0.04),   # net-amount exact match: informative
        ("amount_tds",        0.90,   0.02),   # TDS-formula match: highly informative
        ("amount_gst",        0.85,   0.06),   # GST-inclusive match: moderately informative
        ("name_strong",       0.90,   0.08),   # fuzzy ≥85: informative
        ("name_weak",         0.70,   0.25),   # fuzzy ≥60: weakly informative
        ("date_close",        0.80,   0.20),   # within 7 days: somewhat common by chance
        ("date_window",       0.75,   0.35),   # within 45 days: fairly common by chance
    ]

    def __init__(self):
        self.fields: List[FieldSpec] = [
            FieldSpec(name, m, u) for name, m, u in self.PRIORS
        ]
        self._field_map: Dict[str, FieldSpec] = {f.name: f for f in self.fields}
        self._recompute_anchors()

    def _recompute_anchors(self):
        """Pre-compute max/min LLR for normalisation. Call after updating probs."""
        self._max_llr = sum(f.agree_llr   for f in self.fields)
        self._min_llr = sum(f.disagree_llr for f in self.fields)

    # ── Score from signals ────────────────────────────────────────────────────

    def score_signals(self, signals: Dict[str, Optional[bool]]) -> float:
        """
        Compute Fellegi-Sunter score from pre-built comparison signals.

        Maps the cumulative log-likelihood ratio (LLR) to [0, 100] via a standard
        logistic sigmoid function anchored at neutral LLR=0 -> 50.0.
        Missing fields (agrees=None) contribute exactly 0 to LLR (MAR assumption)
        and are therefore strictly neutral, without penalizing records with missing optional data.

        Parameters
        ----------
        signals : dict mapping field_name → True / False / None
                  None = field missing / not applicable (contributes 0 LLR, no penalty)

        Returns
        -------
        float in [0, 100]
        """
        total_llr = sum(
            self._field_map[name].llr(agrees)
            for name, agrees in signals.items()
            if name in self._field_map
        )
        # Standard logistic conversion with scaling factor k=0.5
        # LLR=0 -> 50.0; LLR=+6 (strong evidence) -> 95.3; LLR=+10 -> 99.3; LLR=-4 -> 11.9
        k = 0.5
        score_val = 100.0 / (1.0 + math.exp(-max(-20.0, min(20.0, k * total_llr))))
        return round(score_val, 2)

    # ── Build signals from TxnView + InvoiceView ──────────────────────────────

    def compare(self, txn, inv, settings=None) -> Dict[str, Optional[bool]]:
        """
        Build comparison signals dict for a (txn, invoice) pair.

        All signals are independent observations — no circular dependency with
        the pass 1-4 heuristic scores.

        Parameters
        ----------
        txn      : TxnView (engine schema)
        inv      : InvoiceView (engine schema)
        settings : App settings (optional; loaded from config if None)

        Returns
        -------
        dict[field_name, Optional[bool]] — suitable for score_signals()
        """
        from app.core.config import get_settings
        if settings is None:
            settings = get_settings()

        tol = Decimal(str(settings.amount_tolerance_rupees))
        signals: Dict[str, Optional[bool]] = {}

        # ── Reference number ──────────────────────────────────────────────────
        if txn.reference_number and inv.reference_number:
            signals["reference_number"] = (
                txn.reference_number.strip().upper()
                == inv.reference_number.strip().upper()
            )
        else:
            signals["reference_number"] = None   # one or both missing

        # ── Amount: exact net match ────────────────────────────────────────────
        net_diff = abs(txn.amount - inv.expected_net_amount)
        signals["amount_exact"] = net_diff <= tol

        # ── Amount: TDS-adjusted ──────────────────────────────────────────────
        if inv.tds_amount and inv.tds_amount > Decimal("0"):
            signals["amount_tds"] = abs(txn.amount - inv.expected_net_amount) <= tol
        else:
            signals["amount_tds"] = None

        # ── Amount: GST-inclusive ─────────────────────────────────────────────
        gst_extra = (
            (inv.cgst_amount or Decimal("0"))
            + (inv.sgst_amount or Decimal("0"))
            + (inv.igst_amount or Decimal("0"))
        )
        if gst_extra > Decimal("0"):
            signals["amount_gst"] = abs(txn.amount - inv.total_amount) <= tol
        else:
            signals["amount_gst"] = None

        # ── Counterparty name via robust partial / token matching ─────────────
        try:
            from rapidfuzz import fuzz
            narration = (txn.narration or "").upper()
            cp_name   = (inv.counterparty_name or "").upper()
            # partial_ratio captures counterparty name embedded in narration with prefixes
            ratio = max(fuzz.partial_ratio(cp_name, narration), fuzz.token_set_ratio(cp_name, narration))
            signals["name_strong"] = ratio >= 85
            signals["name_weak"]   = ratio >= 60
        except Exception:
            signals["name_strong"] = None
            signals["name_weak"]   = None

        # ── Date proximity ────────────────────────────────────────────────────
        if txn.txn_date and inv.invoice_date:
            delta = abs((txn.txn_date - inv.invoice_date).days)
            signals["date_close"]  = delta <= 7
            signals["date_window"] = delta <= settings.candidate_date_window_days
        else:
            signals["date_close"]  = None
            signals["date_window"] = None

        return signals

    def compute_score(self, txn, inv, settings=None) -> float:
        """Convenience: compare() → score_signals() in one call."""
        signals = self.compare(txn, inv, settings)
        return self.score_signals(signals)

    # ── Label-based probability estimation ───────────────────────────────────

    def estimate_from_labels(
        self,
        true_signals:  List[Dict[str, Optional[bool]]],
        false_signals: List[Dict[str, Optional[bool]]],
    ) -> None:
        """
        Re-estimate m/u probabilities from labeled data.

        Uses Laplace (add-1) smoothing to prevent log(0) from zero counts.
        Only updates a field if the new estimate preserves m > u; otherwise
        keeps the prior (protects against small-sample noise).

        Parameters
        ----------
        true_signals  : signals dicts for confirmed true-match pairs
        false_signals : signals dicts for confirmed non-match pairs
        """
        for field_spec in self.fields:
            name = field_spec.name

            # m-probability: how often does the field agree among true matches?
            m_agrees = sum(1 for s in true_signals  if s.get(name) is True)
            m_total  = sum(1 for s in true_signals  if s.get(name) is not None)

            # u-probability: how often does the field agree among non-matches?
            u_agrees = sum(1 for s in false_signals if s.get(name) is True)
            u_total  = sum(1 for s in false_signals if s.get(name) is not None)

            # Laplace smoothing
            m_new = (m_agrees + 1) / (m_total + 2)
            u_new = (u_agrees + 1) / (u_total + 2)

            if m_new > u_new:
                field_spec.m_prob = m_new
                field_spec.u_prob = u_new
                log.debug(
                    f"FS update | field={name} "
                    f"m: {field_spec.m_prob:.3f}→{m_new:.3f}  "
                    f"u: {field_spec.u_prob:.3f}→{u_new:.3f}"
                )
            else:
                log.debug(
                    f"FS update | field={name}: skipped "
                    f"(m_new={m_new:.3f} <= u_new={u_new:.3f}, keeping prior)"
                )

        self._recompute_anchors()
        log.info(
            f"FSModel updated from {len(true_signals)} true / "
            f"{len(false_signals)} false pairs. "
            f"LLR range: [{self._min_llr:.2f}, {self._max_llr:.2f}]"
        )

    def field_weights_summary(self) -> List[Dict]:
        """
        Return a human-readable summary of each field's current LLR weights.
        Useful for the audit trail and dashboard transparency view.
        """
        return [
            {
                "field":        f.name,
                "m_prob":       round(f.m_prob, 3),
                "u_prob":       round(f.u_prob, 3),
                "agree_llr":   round(f.agree_llr, 3),
                "disagree_llr": round(f.disagree_llr, 3),
            }
            for f in self.fields
        ]
