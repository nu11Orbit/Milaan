"""
llm/groq_provider.py
Groq fallback provider — compound-mini primary, secondary model on rate-limit.

Same interface contract as gemini_provider:
  async call(system_prompt, user_message, settings) → (raw_text, AdjudicationResponse)

Rate-limit handling
───────────────────
Groq free tier has a 100k tokens-per-day (TPD) limit per model.  When the
primary model hits its TPD cap, the provider automatically retries with the
groq_fallback_model (a different model with its own separate quota).

This is intentionally kept inside the provider (not the router) so the router
layer stays simple: Gemini → Groq.  Internally Groq has two model slots.

Raises
──────
RateLimitError  : Both Groq models are rate-limited → skip to fallback_no_llm.
ProviderError   : All other failures (timeout, schema, auth, …).
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Optional, Tuple

from groq import Groq
from groq import RateLimitError as GroqSDKRateLimitError
from pydantic import ValidationError

from app.llm.schemas import AdjudicationResponse
from app.core.config import get_settings

log = logging.getLogger(__name__)


# ── Re-export error classes (router imports from here) ────────────────────────
from app.llm.gemini_provider import ProviderError, RateLimitError  # noqa: E402, F401


def _call_sync(
    client: Groq,
    model: str,
    system_prompt: str,
    user_message: str,
    timeout_s: int,
) -> tuple[str, object]:
    """
    Synchronous Groq call — run in an executor thread.
    Returns (raw_text, usage_object).
    Raises GroqSDKRateLimitError on 429, Exception on all others.
    """
    completion = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user",   "content": user_message},
        ],
        temperature=0.1,
        max_tokens=1024,
        response_format={"type": "json_object"},
    )
    return completion.choices[0].message.content.strip(), completion.usage


async def _try_model(
    client: Groq,
    model: str,
    system_prompt: str,
    user_message: str,
    timeout_s: int,
) -> Tuple[str, AdjudicationResponse]:
    """
    Attempt a single Groq model.

    Raises RateLimitError on 429, ProviderError on all other failures.
    """
    loop = asyncio.get_event_loop()
    t0   = time.monotonic()
    try:
        raw_text, usage = await asyncio.wait_for(
            loop.run_in_executor(
                None,
                lambda: _call_sync(client, model, system_prompt, user_message, timeout_s),
            ),
            timeout=timeout_s,
        )
        elapsed = time.monotonic() - t0
        in_tok  = usage.prompt_tokens     if usage else "?"
        out_tok = usage.completion_tokens if usage else "?"
        log.info(
            f"Groq/{model} call OK in {elapsed:.2f}s  [{in_tok}→{out_tok} tokens]"
        )
    except asyncio.TimeoutError:
        raise ProviderError(f"Groq/{model} timeout after {timeout_s}s")
    except GroqSDKRateLimitError as e:
        raise RateLimitError(f"Groq/{model} rate-limited (429): {str(e)[:200]}")
    except Exception as e:
        # Re-raise RateLimitError so it propagates correctly
        if isinstance(e, RateLimitError):
            raise
        err_str = str(e)
        if "429" in err_str or "rate_limit" in err_str.lower():
            raise RateLimitError(f"Groq/{model} rate-limited: {err_str[:200]}")
        raise ProviderError(f"Groq/{model} API error: {e}")

    # ── Parse and validate ────────────────────────────────────────────────────
    try:
        data   = json.loads(raw_text)
        result = AdjudicationResponse(**data)
    except (json.JSONDecodeError, ValidationError, TypeError) as e:
        raise ProviderError(
            f"Groq/{model} returned invalid JSON/schema: {e} | raw={raw_text[:200]}"
        )

    return raw_text, result


async def call(
    system_prompt: str,
    user_message:  str,
    settings=None,
) -> Tuple[str, AdjudicationResponse]:
    """
    Call Groq and return (raw_response_text, AdjudicationResponse).

    Tries groq_model first; on RateLimitError (429 TPD/RPM) automatically
    falls through to groq_fallback_model.  If both are rate-limited, raises
    RateLimitError so the router falls through to fallback_no_llm.

    Raises ProviderError on timeout, auth errors, or schema failures.
    """
    if settings is None:
        settings = get_settings()

    if not settings.groq_api_key:
        raise ProviderError("Groq API key not configured")

    client = Groq(api_key=settings.groq_api_key)

    primary_model  = settings.groq_model
    fallback_model = settings.groq_fallback_model

    # ── Primary model ─────────────────────────────────────────────────────────
    try:
        return await _try_model(
            client, primary_model, system_prompt, user_message,
            settings.llm_timeout_seconds,
        )
    except RateLimitError as e:
        log.warning(f"Groq primary model rate-limited, trying fallback: {e}")

    # ── Fallback model ────────────────────────────────────────────────────────
    if fallback_model and fallback_model != primary_model:
        try:
            return await _try_model(
                client, fallback_model, system_prompt, user_message,
                settings.llm_timeout_seconds,
            )
        except RateLimitError as e:
            log.warning(f"Groq fallback model also rate-limited: {e}")
            raise RateLimitError(
                f"Both Groq models ({primary_model}, {fallback_model}) are rate-limited"
            )

    raise RateLimitError(f"Groq/{primary_model} is rate-limited and no fallback model configured")
