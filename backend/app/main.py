"""
app/main.py
FastAPI application entrypoint for ReconAI.

Startup sequence:
  1. init_beanie() connects to MongoDB Atlas and registers all Document models.
  2. Collections + indexes are auto-created on first run.
  3. CORS is configured for local Next.js dev (port 3000) and Vercel deployments.

The /health endpoint verifies Atlas connectivity so you can confirm the
connection string is correct before running anything else.
"""

from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings
from app.core.db import init_db


# ── Lifespan (modern FastAPI pattern — replaces deprecated @app.on_event) ─────

@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator:
    """Connect to MongoDB Atlas on startup, warm up embedding model."""
    await init_db()
    # Warm up the sentence-transformer model so the first request isn't slow
    try:
        from app.engine.pass3_embedding import preload_model
        preload_model()
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning(f"Embedding model preload failed (non-fatal): {e}")
    yield


# ── App factory ───────────────────────────────────────────────────────────────

def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title="ReconAI — Reconciliation Engine",
        description=(
            "GST/TDS-aware, confidence-scored bank-to-invoice reconciliation "
            "for Indian SMEs. Razorpay AI Buildathon — Track 04."
        ),
        version="0.1.0",
        lifespan=lifespan,
    )

    # ── CORS ──────────────────────────────────────────────────────────────────
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # ── Routers ───────────────────────────────────────────────────────────────
    from app.api.routes_upload import router as upload_router
    from app.api.routes_run import router as run_router
    from app.api.routes_results import router as results_router
    from app.api.routes_audit import router as audit_router
    app.include_router(upload_router, prefix="/api", tags=["batches"])
    app.include_router(run_router,    prefix="/api", tags=["run"])
    app.include_router(results_router,prefix="/api", tags=["results", "config"])
    app.include_router(audit_router,  prefix="/api", tags=["audit"])

    return app


app = create_app()


# ── Health check ──────────────────────────────────────────────────────────────

@app.get("/health", tags=["meta"])
async def health_check():
    """
    Verifies the app is running and Atlas is reachable.
    A successful response confirms:
      - FastAPI started correctly
      - Beanie connected to MongoDB Atlas
      - All collections + indexes were registered

    Use this before running any reconciliation to confirm your MONGODB_URI works.
    """
    from app.models.merchant import Merchant

    # Ping Atlas with a lightweight count query
    try:
        count = await Merchant.count()
        atlas_status = "connected"
    except Exception as exc:
        atlas_status = f"error: {exc}"

    settings = get_settings()

    return {
        "status": "ok",
        "atlas": atlas_status,
        "db": settings.mongodb_db_name,
        "thresholds": {
            "auto_accept": settings.threshold_auto_accept,
            "review": settings.threshold_review,
        },
    }
