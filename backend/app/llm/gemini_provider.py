"""
llm/gemini_provider.py
Gemini REST provider — uses httpx to call the Gemini generateContent REST
endpoint directly instead of the google-generativeai SDK's gRPC transport.

WHY REST INSTEAD OF THE SDK:
  The google-generativeai SDK uses gRPC under the hood. gRPC channels are
  NOT fork-safe. uvicorn --reload forks worker processes AFTER the import
  phase (and after any module-level gRPC initialisation), which silently
  corrupts the channel and causes every subsequent call to block until the
  timeout fires. Switching to REST (plain HTTPS) eliminates this entirely —
  REST connections are created per-request and have no fork-safety concerns.

Interface contract:
  async call(system_prompt, user_message, settings) → (raw_text, AdjudicationResponse)

Raises ProviderError on all failure types so the router can handle them uniformly.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Tuple

import httpx
from pydantic import ValidationError

from app.llm.schemas import AdjudicationResponse
from app.core.config import get_settings

log = logging.getLogger(__name__)

_GEMINI_REST_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models"
    "/{model}:generateContent"
)


class ProviderError(Exception):
    """Raised by any LLM provider on failure — router catches this."""
    pass


def _extract_json(text: str) -> dict:
    """
    Extract the first JSON object from a free-form LLM response.
    Handles both bare JSON and JSON wrapped in ```json ... ``` fences.
    """
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if fenced:
        return json.loads(fenced.group(1))

    start = text.find("{")
    if start == -1:
        raise json.JSONDecodeError("No JSON object found", text, 0)

    depth = 0
    for i, ch in enumerate(text[start:], start):
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return json.loads(text[start : i + 1])

    raise json.JSONDecodeError("Unmatched braces in response", text, start)


async def call(
    system_prompt: str,
    user_message:  str,
    settings=None,
) -> Tuple[str, AdjudicationResponse]:
    """
    Call Gemini via REST and return (raw_response_text, AdjudicationResponse).

    Uses httpx directly against the Gemini REST endpoint — no gRPC, no
    fork-safety issues with uvicorn --reload.

    Raises ProviderError on timeout, HTTP errors, invalid JSON, or schema errors.
    """
    if settings is None:
        settings = get_settings()

    if not settings.gemini_api_key:
        raise ProviderError("Gemini API key not configured")

    url = _GEMINI_REST_URL.format(model=settings.gemini_model)
    payload = {
        "contents": [
            {
                "parts": [
                    {"text": f"{system_prompt}\n\n---\n\n{user_message}"}
                ]
            }
        ],
        "generationConfig": {
            "temperature": 0.1,
            "maxOutputTokens": 2048,
        },
    }

    # Timeout: observed p95 latency ~1.5s outside FastAPI; 15s gives ample
    # headroom for network variance without blocking the reconciliation loop.
    timeout = max(settings.llm_timeout_seconds, 15)

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                url,
                json=payload,
                params={"key": settings.gemini_api_key},
                timeout=timeout,
            )
        resp.raise_for_status()
        data = resp.json()
        raw_text = data["candidates"][0]["content"]["parts"][0]["text"].strip()
        log.info(f"Gemini REST call completed successfully")

    except httpx.TimeoutException:
        raise ProviderError(f"Gemini REST timeout after {timeout}s")
    except httpx.HTTPStatusError as e:
        raise ProviderError(f"Gemini API error: {e.response.status_code} {e.response.text[:200]}")
    except (KeyError, IndexError) as e:
        raise ProviderError(f"Gemini unexpected response structure: {e}")
    except Exception as e:
        raise ProviderError(f"Gemini API error: {e}")

    # ── Parse and validate response ───────────────────────────────────────────
    try:
        parsed = _extract_json(raw_text)
        result = AdjudicationResponse(**parsed)
    except (json.JSONDecodeError, ValidationError, TypeError) as e:
        raise ProviderError(f"Gemini returned invalid JSON/schema: {e} | raw={raw_text[:200]}")

    return raw_text, result


