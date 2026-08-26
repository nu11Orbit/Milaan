"""
llm/groq_provider.py
Groq (Llama 3.3 70B Versatile) fallback provider.

Same interface contract as gemini_provider:
  async call(system_prompt, user_message, settings) → (raw_text, AdjudicationResponse)

Raises ProviderError on all failure types.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Tuple

from groq import Groq
from pydantic import ValidationError

from app.llm.schemas import AdjudicationResponse
from app.core.config import get_settings

log = logging.getLogger(__name__)


async def call(
    system_prompt: str,
    user_message:  str,
    settings=None,
) -> Tuple[str, AdjudicationResponse]:
    """
    Call Groq (Llama 3.3 70B) and return (raw_response_text, AdjudicationResponse).

    Raises ProviderError on timeout, auth errors, invalid JSON, or schema errors.
    """
    if settings is None:
        settings = get_settings()

    if not settings.groq_api_key:
        raise ProviderError("Groq API key not configured")

    t0 = time.monotonic()
    try:
        client = Groq(api_key=settings.groq_api_key)

        loop = asyncio.get_event_loop()
        completion = await asyncio.wait_for(
            loop.run_in_executor(
                None,
                lambda: client.chat.completions.create(
                    model=settings.groq_model,
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user",   "content": user_message},
                    ],
                    temperature=0.1,
                    max_tokens=512,
                    response_format={"type": "json_object"},
                ),
            ),
            timeout=settings.llm_timeout_seconds,
        )

        raw_text = completion.choices[0].message.content.strip()
        elapsed  = time.monotonic() - t0
        in_tok   = completion.usage.prompt_tokens if completion.usage else "?"
        out_tok  = completion.usage.completion_tokens if completion.usage else "?"
        log.info(f"Groq call completed in {elapsed:.2f}s  [{in_tok}→{out_tok} tokens]")

    except asyncio.TimeoutError:
        raise ProviderError(f"Groq timeout after {settings.llm_timeout_seconds}s")
    except Exception as e:
        raise ProviderError(f"Groq API error: {e}")

    # ── Parse and validate ─────────────────────────────────────────────────────
    try:
        data   = json.loads(raw_text)
        result = AdjudicationResponse(**data)
    except (json.JSONDecodeError, ValidationError, TypeError) as e:
        raise ProviderError(f"Groq returned invalid JSON/schema: {e} | raw={raw_text[:200]}")

    return raw_text, result


# Re-export so router can import from one place
from app.llm.gemini_provider import ProviderError  # noqa: E402, F401
