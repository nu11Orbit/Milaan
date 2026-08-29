"""
core/db.py
MongoDB Atlas connection via Motor + Beanie ODM.

Call `init_db()` once at FastAPI startup.
All Beanie Document models are imported here so Beanie registers them
and auto-creates collections + indexes on first run.
"""

from motor.motor_asyncio import AsyncIOMotorClient
from beanie import init_beanie

from app.core.config import get_settings


async def init_db() -> None:
    """
    Connect to MongoDB Atlas and initialise Beanie with all Document models.
    Collections and indexes are created automatically if they don't exist.
    Called from app.main lifespan context.
    """
    settings = get_settings()

    # Lazy import to avoid circular imports between models and db
    from app.models.merchant import Merchant
    from app.models.invoice import Invoice
    from app.models.bank_transaction import BankTransaction
    from app.models.match import Match
    from app.models.audit_log_entry import AuditLogEntry
    from app.models.ground_truth_label import GroundTruthLabel

    import certifi

    client = AsyncIOMotorClient(
        settings.mongodb_uri,
        serverSelectionTimeoutMS=5000,   # fail fast if Atlas is unreachable
        tlsCAFile=certifi.where(),       # macOS: python.org Python needs explicit CA bundle
    )

    await init_beanie(
        database=client[settings.mongodb_db_name],
        document_models=[
            Merchant,
            Invoice,
            BankTransaction,
            Match,
            AuditLogEntry,
            GroundTruthLabel,
        ],
    )
