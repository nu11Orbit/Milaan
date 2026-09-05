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

# Fast-fail: short connect window — if the server doesn't start sending a
# response within 5 s we bail immediately (observed behaviour with some
# flash-lite variants that accept the request but never return a body).
# Read timeout is generous because gemini-3.6-flash is a thinking model and
# spends ~100-300 tokens on internal reasoning before writing visible output.
_GEMINI_CONNECT_TIMEOUT = 5.0
_GEMINI_READ_TIMEOUT    = 30.0   # match LLM_TIMEOUT_SECONDS env var


class ProviderError(Exception):
    """Raised by any LLM provider on a recoverable failure — router retries."""
    pass


class RateLimitError(ProviderError):
    """
    Raised when a provider returns HTTP 429 (quota exhausted) or 503 (capacity).
    The router SKIPS retries on this error and immediately tries the next
    provider — retrying the same provider with backoff is pointless when the
    daily/minute token quota is fully exhausted.
    """
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
    # maxOutputTokens: 1024 comfortably holds the JSON output after the model's
    # internal thinking phase (gemini-3.6-flash uses ~100-300 thinking tokens
    # which don't count against this budget — they appear as thoughtsTokenCount
    # in usageMetadata, not as candidatesTokenCount).
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
            "maxOutputTokens": 1024,
        },
    }

    # Use a combined Timeout: short connect+pool window to fail fast if
    # the generateContent endpoint is unreachable/blocked (observed behaviour
    # where the request hangs indefinitely with 0 bytes returned).  A longer
    # read window handles legitimate slow generation.
    timeout = httpx.Timeout(
        connect=_GEMINI_CONNECT_TIMEOUT,
        read=_GEMINI_READ_TIMEOUT,
        write=5.0,
        pool=5.0,
    )

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

        # ── Extract text robustly ──────────────────────────────────────────────
        # gemini-3.6-flash (thinking model) returns parts like:
        #   [{"text": "...", "thoughtSignature": "<base64>"}]
        # We iterate parts and concatenate all text values (skipping empty ones).
        # If no text is found the model hit MAX_TOKENS during the thinking phase;
        # we raise ProviderError so the circuit breaker records the failure and
        # falls through to Groq.
        candidate = data["candidates"][0]
        finish_reason = candidate.get("finishReason", "STOP")
        parts = candidate.get("content", {}).get("parts", [])
        raw_text = " ".join(
            p["text"].strip()
            for p in parts
            if isinstance(p.get("text"), str) and p["text"].strip()
        )
        if not raw_text:
            raise ProviderError(
                f"Gemini returned no text content (finishReason={finish_reason}). "
                "Model may have exhausted token budget during thinking phase. "
                "Falling over to Groq."
            )
        log.info(
            f"Gemini REST call OK — finishReason={finish_reason}, "
            f"thoughtsTokens={data.get('usageMetadata', {}).get('thoughtsTokenCount', '?')}, "
            f"outputTokens={data.get('usageMetadata', {}).get('candidatesTokenCount', '?')}"
        )

    except httpx.TimeoutException as e:
        raise ProviderError(
            f"Gemini REST timeout (connect={_GEMINI_CONNECT_TIMEOUT}s / "
            f"read={_GEMINI_READ_TIMEOUT}s): {e}"
        )
    except httpx.HTTPStatusError as e:
        status = e.response.status_code
        body   = e.response.text[:300]
        if status in (429, 503):
            raise RateLimitError(
                f"Gemini quota/capacity (HTTP {status}): "
                f"{e.response.json().get('error', {}).get('message', body)[:200]}"
            )
        raise ProviderError(f"Gemini API HTTP {status}: {body}")
    except (KeyError, IndexError) as e:
        raise ProviderError(f"Gemini unexpected response structure: {e}")
    except Exception as e:
        raise ProviderError(f"Gemini API error: {type(e).__name__}: {e}")

    # ── Parse and validate response ───────────────────────────────────────────
    try:
        parsed = _extract_json(raw_text)
        result = AdjudicationResponse(**parsed)
    except (json.JSONDecodeError, ValidationError, TypeError) as e:
        raise ProviderError(f"Gemini returned invalid JSON/schema: {e} | raw={raw_text[:200]}")

    return raw_text, result


