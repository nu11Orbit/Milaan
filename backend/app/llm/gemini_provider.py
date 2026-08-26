"""
llm/gemini_provider.py
Gemini 2.5 Flash-Lite provider.

Interface contract:
  async call(system_prompt, user_message, timeout_s) → (raw_text, AdjudicationResponse)

Raises ProviderError on all failure types so the router can handle them uniformly.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Tuple

import google.generativeai as genai
from pydantic import ValidationError

from app.llm.schemas import AdjudicationResponse
from app.core.config import get_settings

log = logging.getLogger(__name__)


class ProviderError(Exception):
    """Raised by any LLM provider on failure — router catches this."""
    pass


def _init_gemini(api_key: str, model_name: str) -> genai.GenerativeModel:
    genai.configure(api_key=api_key)
    return genai.GenerativeModel(
        model_name=model_name,
        generation_config=genai.types.GenerationConfig(
            temperature=0.1,      # low temp — we want deterministic JSON
            max_output_tokens=512,
            response_mime_type="application/json",
        ),
    )


async def call(
    system_prompt: str,
    user_message:  str,
    settings=None,
) -> Tuple[str, AdjudicationResponse]:
    """
    Call Gemini and return (raw_response_text, AdjudicationResponse).

    Raises ProviderError on:
    - Invalid API key / auth errors
    - Timeout (settings.llm_timeout_seconds)
    - Non-JSON or schema-invalid response
    - Any other API error
    """
    if settings is None:
        settings = get_settings()

    if not settings.gemini_api_key:
        raise ProviderError("Gemini API key not configured")

    t0 = time.monotonic()
    try:
        model = _init_gemini(settings.gemini_api_key, settings.gemini_model)

        # Gemini handles system + user as a combined prompt for Flash-Lite
        combined_prompt = f"{system_prompt}\n\n---\n\n{user_message}"

        # Run in executor to avoid blocking the event loop
        loop = asyncio.get_event_loop()
        response = await asyncio.wait_for(
            loop.run_in_executor(None, lambda: model.generate_content(combined_prompt)),
            timeout=settings.llm_timeout_seconds,
        )

        raw_text = response.text.strip()
        elapsed  = time.monotonic() - t0
        log.info(f"Gemini call completed in {elapsed:.2f}s")

    except asyncio.TimeoutError:
        raise ProviderError(f"Gemini timeout after {settings.llm_timeout_seconds}s")
    except Exception as e:
        raise ProviderError(f"Gemini API error: {e}")

    # ── Parse and validate response ───────────────────────────────────────────
    try:
        data = json.loads(raw_text)
        result = AdjudicationResponse(**data)
    except (json.JSONDecodeError, ValidationError, TypeError) as e:
        raise ProviderError(f"Gemini returned invalid JSON/schema: {e} | raw={raw_text[:200]}")

    return raw_text, result
