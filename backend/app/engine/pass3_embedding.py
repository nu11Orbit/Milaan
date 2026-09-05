"""
engine/pass3_embedding.py
Pass 3 — Semantic Embedding Similarity
========================================

Uses `sentence-transformers/all-MiniLM-L6-v2` (22M params, CPU-friendly).
Model is lazy-loaded as a module-level singleton — loaded once on first call,
cached for the lifetime of the process (≈ 500ms one-time cost).

When does Pass 3 run?
─────────────────────
Only for candidates not resolved by Pass 1 or Pass 2 (score < 70).
It is the last deterministic pass before LLM adjudication (Pass 5).

How it works
────────────
1. Build a "text fingerprint" for the transaction:
     "{narration} amount {amount} date {date}"
2. Build a "text fingerprint" for each candidate invoice:
     "{counterparty_name} invoice {invoice_id} amount {expected_net} date {invoice_date}"
3. Encode all strings in one batched call (efficient on CPU).
4. Compute cosine similarity between txn embedding and each invoice embedding.
5. Top-k candidates above `embedding_similarity_floor` get a score contribution.

Score contribution
──────────────────
similarity ≥ floor  → +0 to +20 pts (scaled linearly from floor → 1.0)
similarity < floor  → +0 pts, fired=False

Pass 3 resolves if combined score ≥ 70 after contribution.
Otherwise → candidate forwarded to Pass 5 (LLM adjudication).
"""

from __future__ import annotations

import logging
from typing import List, Optional

import numpy as np

from app.engine.schemas import CandidateMatch, InvoiceView, TxnView
from app.core.config import get_settings

log = logging.getLogger(__name__)

# ── Lazy singleton for the embedding model ────────────────────────────────────

_model = None


def _get_model():
    """
    Lazy-load the sentence-transformer model.
    Thread-safe enough for our single-worker uvicorn setup.
    Downloads ~90MB on first run, then uses the local cache.
    """
    global _model
    if _model is None:
        from sentence_transformers import SentenceTransformer
        log.info("Loading sentence-transformers model all-MiniLM-L6-v2…")
        try:
            _model = SentenceTransformer("all-MiniLM-L6-v2", local_files_only=True)
        except Exception:
            _model = SentenceTransformer("all-MiniLM-L6-v2")
        log.info("Model loaded ✓")
    return _model


def _cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    """Cosine similarity between two 1-D numpy arrays."""
    norm_a = np.linalg.norm(a)
    norm_b = np.linalg.norm(b)
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return float(np.dot(a, b) / (norm_a * norm_b))


# ── Text fingerprint builders ─────────────────────────────────────────────────

def _txn_text(txn: TxnView) -> str:
    """
    Build a rich text string for the transaction.
    Includes raw narration (most signal-rich field), amount, and date.
    """
    parts = [txn.narration]
    parts.append(f"amount {txn.amount}")
    parts.append(f"date {txn.txn_date.strftime('%d %B %Y')}")
    if txn.channel:
        parts.append(f"channel {txn.channel}")
    return " ".join(parts)


def _invoice_text(inv: InvoiceView) -> str:
    """
    Build a rich text string for the invoice.
    Uses counterparty name (main linking field), amounts, and date.
    """
    parts = [inv.counterparty_name]
    parts.append(f"invoice amount {inv.expected_net_amount}")
    if inv.tds_amount and inv.tds_amount > 0:
        parts.append(f"tds deducted {inv.tds_amount} section {inv.tds_section or ''}")
    parts.append(f"total {inv.total_amount}")
    parts.append(f"date {inv.invoice_date.strftime('%d %B %Y')}")
    return " ".join(parts)


# ── Max score contribution from this pass ─────────────────────────────────────
MAX_EMBEDDING_PTS = 20.0
PASS3_RESOLVE_THRESHOLD = 70.0


# ── Main Pass 3 function ───────────────────────────────────────────────────────

def run_pass3(
    txn: TxnView,
    candidates: List[CandidateMatch],
    all_invoices_by_id: dict,  # invoice_id → InvoiceView
    settings=None,
) -> List[CandidateMatch]:
    """
    Apply semantic embedding similarity to unresolved candidates.

    Encodes all strings in one batch for efficiency, then assigns cosine
    similarity scores to each candidate.

    Parameters
    ----------
    txn               : Bank transaction being matched.
    candidates        : CandidateMatch list (sorted desc), partially resolved.
    all_invoices_by_id: {invoice_id: InvoiceView} lookup.
    settings          : Injected settings.

    Returns
    -------
    Updated candidates list, still sorted desc.
    """
    if settings is None:
        settings = get_settings()

    # Graceful degradation: skip Pass 3 entirely on memory-constrained deploys.
    # Set ENABLE_SEMANTIC_EMBEDDING=false in Render env vars if OOM persists.
    # Records fall through to Pass 4/5 — no hard failure.
    if not settings.enable_semantic_embedding:
        log.info("Pass 3 disabled (ENABLE_SEMANTIC_EMBEDDING=false) — skipping.")
        return candidates

    floor      = settings.embedding_similarity_floor
    top_k      = settings.embedding_top_k

    # Collect only unresolved candidates
    unresolved = [cm for cm in candidates if cm.resolved_by is None]
    if not unresolved:
        return candidates

    # Collect invoice views for unresolved candidates
    inv_views: List[Optional[InvoiceView]] = [
        all_invoices_by_id.get(cm.invoice_id) for cm in unresolved
    ]

    # Build text strings for batch encoding
    txn_text_str   = _txn_text(txn)
    inv_text_strs  = [
        _invoice_text(inv) if inv else ""
        for inv in inv_views
    ]

    all_texts = [txn_text_str] + inv_text_strs

    try:
        model = _get_model()
        embeddings = model.encode(
            all_texts,
            convert_to_numpy=True,
            show_progress_bar=False,
            batch_size=32,
        )
    except Exception as e:
        log.warning(f"Pass 3 embedding failed for txn {txn.txn_id}: {e}")
        # Non-fatal — candidates simply don't get embedding score
        for cm in unresolved:
            cm.add("pass3_embedding", 0.0, f"Embedding unavailable: {e}", fired=False)
        return candidates

    txn_emb  = embeddings[0]
    inv_embs = embeddings[1:]

    # Assign scores
    scored = []
    for i, (cm, inv, inv_emb) in enumerate(zip(unresolved, inv_views, inv_embs)):
        if inv is None or len(inv_emb) == 0:
            cm.add("pass3_embedding", 0.0, "Invoice not found", fired=False)
            continue

        sim = _cosine_similarity(txn_emb, inv_emb)

        if sim >= floor:
            # Scale linearly: sim=floor → 0 pts, sim=1.0 → MAX_EMBEDDING_PTS
            pts = MAX_EMBEDDING_PTS * (sim - floor) / (1.0 - floor)
            cm.add(
                "pass3_embedding", round(pts, 2),
                f"Semantic similarity: {sim:.3f} (floor={floor:.2f})"
                f" — '{inv.counterparty_name[:20]}' vs narration",
            )
        else:
            cm.add(
                "pass3_embedding", 0.0,
                f"Semantic similarity {sim:.3f} below floor {floor:.2f}",
                fired=False,
            )

        scored.append((cm, sim))

    # Resolve top-k candidates that cleared the threshold
    scored.sort(key=lambda x: x[1], reverse=True)
    for cm, sim in scored[:top_k]:
        if cm.score >= PASS3_RESOLVE_THRESHOLD and cm.resolved_by is None:
            amount_matched = any(
                c.source in ("pass1_amount_exact", "pass1_amount_gross", "pass1_tds_adjusted", "pass1_gateway_fee", "pass2_amount_fuzzy") and c.rule_fired
                for c in cm.contributions
            )
            if amount_matched:
                cm.resolved_by = "pass3_embedding"
                cm.match_type  = "one_to_one"

    # Re-sort all candidates
    candidates.sort(key=lambda c: c.score, reverse=True)
    return candidates


def preload_model() -> None:
    """
    Eagerly load the embedding model.
    Call this from the FastAPI lifespan if you want the model warm
    before the first reconciliation request arrives.
    """
    _get_model()
