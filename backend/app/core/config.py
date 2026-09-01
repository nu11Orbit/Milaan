"""
core/config.py
All application settings loaded from environment variables.
Pydantic-settings v2 — add a field here, set it in .env, done.
"""

from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache

# Repo root is 3 levels up from this file:
# backend/app/core/config.py → backend/app/core → backend/app → backend → repo root
_REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
_ENV_FILE = _REPO_ROOT / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(_ENV_FILE),   # absolute path — works regardless of CWD
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── Database ───────────────────────────────────────────────────────────────
    mongodb_uri: str
    mongodb_db_name: str = "reconai"

    # ── LLM providers ─────────────────────────────────────────────────────────
    gemini_api_key: str = ""
    groq_api_key: str = ""

    # Gemini model to use
    gemini_model: str = "gemini-3.6-flash"
    groq_model: str = "groq/compound-mini"

    # ── LLM router resilience ─────────────────────────────────────────────────
    llm_timeout_seconds: int = 8
    llm_max_retries: int = 1
    # Circuit breaker: skip a provider after this many consecutive failures
    llm_circuit_breaker_threshold: int = 3

    # ── Confidence band thresholds (all adjustable via /api/config/thresholds) ─
    threshold_auto_accept: float = 85.0   # score >= this → auto_accept
    threshold_review: float = 50.0        # score >= this → review (else reject)

    # ── Matching engine ───────────────────────────────────────────────────────
    # Amount tolerance in rupees for exact / formula matches
    amount_tolerance_rupees: float = 2.0

    # Date window in days for candidate narrowing
    candidate_date_window_days: int = 60

    # Pass 2 fuzzy: minimum composite score to proceed
    fuzzy_score_threshold: float = 60.0

    # Pass 3 embedding: cosine similarity floor
    embedding_similarity_floor: float = 0.5
    embedding_top_k: int = 5

    # Pass 4 split matcher: max candidate pool before flagging for LLM
    split_pool_max_size: int = 16

    # Gateway fee rate (Razorpay-style 2% + 18% GST on fee)
    gateway_fee_rate: float = 0.02
    gateway_fee_gst_rate: float = 0.18

    # ── CORS ──────────────────────────────────────────────────────────────────
    cors_origins: list[str] = ["http://localhost:3000", "https://*.vercel.app"]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Cached settings singleton — import and call this everywhere."""
    return Settings()
