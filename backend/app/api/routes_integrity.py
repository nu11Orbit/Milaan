"""
api/routes_integrity.py
Benford's Law Forensic Integrity Endpoint
==========================================

Exposes statistical anomaly and forensic fraud signals across batch financial amounts.
"""

from __future__ import annotations

import logging
from fastapi import APIRouter, HTTPException

from app.engine.benfords_law import run_benford_integrity_analysis

log = logging.getLogger(__name__)
router = APIRouter()


@router.get("/batches/{batch_id}/integrity")
async def get_batch_integrity(batch_id: str):
    """
    Run Benford's Law forensic analysis across invoice and transaction amounts in this batch.

    Returns:
    - Overall fraud/integrity risk level (low / medium / high)
    - Chi-Square statistic and p-value for invoices and bank transactions
    - Observed vs expected first-digit distributions (for frontend chart)
    - Antibenford suspicious counterparty clustering detections
    - Auditor methodology & interpretation
    """
    try:
        result = await run_benford_integrity_analysis(batch_id)
        if result.get("status") == "empty":
            raise HTTPException(status_code=404, detail=result.get("error"))
        return result
    except HTTPException:
        raise
    except Exception as e:
        log.error(f"Integrity analysis failed for batch {batch_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Integrity analysis failed: {str(e)}")
