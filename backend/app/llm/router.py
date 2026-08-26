"""
llm/router.py
LLM Router — Primary Gemini → Failover Groq
=============================================

Responsibilities:
  1. Try Gemini. On failure, retry with exponential backoff + jitter.
  2. After max_retries, fail over to Groq. Same retry policy.
  3. Circuit breaker: if a provider fails N consecutive times mid-batch,
     mark it "open" (skip) for the remainder of the batch.
  4. If BOTH providers exhausted → return AdjudicationResponse.fallback_no_llm().
     The batch NEVER crashes due to LLM unavailability.
  5. Log per-call latency and token counts.

Circuit breaker state is per-router instance (in-memory).
For a demo single-worker deployment this is sufficient.

Usage:
    router = LLMRouter()
    response, provider_used, raw_text = await router.adjudicate(system, user)
"""

from __future__ import annotations

import asyncio
import logging
import random
import time
from typing import Optional, Tuple

from app.llm import gemini_provider, groq_provider
from app.llm.gemini_provider import ProviderError
from app.llm.schemas import AdjudicationResponse
from app.core.config import get_settings

log = logging.getLogger(__name__)

# ── Retry / backoff config ────────────────────────────────────────────────────
BASE_BACKOFF_S  = 0.5    # initial wait before first retry
BACKOFF_FACTOR  = 2.0    # each retry doubles the wait
JITTER_FRACTION = 0.25   # ±25% jitter added to each backoff


def _backoff(attempt: int) -> float:
    """Exponential backoff with full jitter."""
    delay = BASE_BACKOFF_S * (BACKOFF_FACTOR ** attempt)
    jitter = delay * JITTER_FRACTION * (2 * random.random() - 1)
    return max(0.0, delay + jitter)


class CircuitBreaker:
    """
    Simple in-memory circuit breaker for one provider.

    States:
      closed  — provider healthy, calls go through
      open    — too many failures, provider skipped
    """

    def __init__(self, name: str, threshold: int):
        self.name            = name
        self.threshold       = threshold
        self.consecutive_fails = 0
        self._open           = False

    @property
    def is_open(self) -> bool:
        return self._open

    def record_success(self):
        self.consecutive_fails = 0
        self._open = False

    def record_failure(self):
        self.consecutive_fails += 1
        if self.consecutive_fails >= self.threshold:
            if not self._open:
                log.warning(
                    f"Circuit breaker OPEN for {self.name} "
                    f"after {self.consecutive_fails} consecutive failures"
                )
            self._open = True

    def reset(self):
        """Call between batches to give the provider another chance."""
        self.consecutive_fails = 0
        self._open = False


class LLMRouter:
    """
    Thread-safe (asyncio) LLM router with failover and circuit breaking.

    Instantiate once per reconciliation batch (or re-use across batches after
    calling reset_circuit_breakers() between them).
    """

    def __init__(self, settings=None):
        if settings is None:
            settings = get_settings()
        self.settings    = settings
        self.max_retries = settings.llm_max_retries
        self._cb_gemini  = CircuitBreaker("gemini", settings.llm_circuit_breaker_threshold)
        self._cb_groq    = CircuitBreaker("groq",   settings.llm_circuit_breaker_threshold)

    def reset_circuit_breakers(self):
        """Call at the start of each new batch."""
        self._cb_gemini.reset()
        self._cb_groq.reset()

    async def _try_provider(
        self,
        name: str,
        provider_call,         # coroutine function: (system, user, settings) → (raw, result)
        circuit: CircuitBreaker,
        system_prompt: str,
        user_message:  str,
    ) -> Optional[Tuple[str, AdjudicationResponse]]:
        """
        Attempt provider with retries. Returns (raw_text, result) or None on failure.
        Updates circuit breaker state.
        """
        if circuit.is_open:
            log.info(f"Skipping {name} — circuit breaker is open")
            return None

        for attempt in range(self.max_retries + 1):
            t0 = time.monotonic()
            try:
                raw_text, result = await provider_call(
                    system_prompt, user_message, self.settings
                )
                circuit.record_success()
                elapsed = time.monotonic() - t0
                log.info(f"{name} succeeded on attempt {attempt+1} in {elapsed:.2f}s")
                return raw_text, result

            except ProviderError as e:
                circuit.record_failure()
                elapsed = time.monotonic() - t0
                log.warning(
                    f"{name} attempt {attempt+1}/{self.max_retries+1} failed "
                    f"in {elapsed:.2f}s: {e}"
                )
                if attempt < self.max_retries:
                    wait = _backoff(attempt)
                    log.info(f"Backing off {wait:.2f}s before retry…")
                    await asyncio.sleep(wait)

        return None   # All retries exhausted

    async def adjudicate(
        self,
        system_prompt: str,
        user_message:  str,
    ) -> Tuple[AdjudicationResponse, str, str]:
        """
        Route to Gemini, fall back to Groq, return safe fallback if both fail.

        Returns
        -------
        (AdjudicationResponse, provider_name, raw_response_text)

        provider_name is one of: "gemini", "groq", "fallback_no_llm"
        """
        # ── Primary: Gemini ────────────────────────────────────────────────────
        result = await self._try_provider(
            "gemini", gemini_provider.call, self._cb_gemini,
            system_prompt, user_message,
        )
        if result:
            raw_text, response = result
            return response, "gemini", raw_text

        # ── Fallback: Groq ─────────────────────────────────────────────────────
        result = await self._try_provider(
            "groq", groq_provider.call, self._cb_groq,
            system_prompt, user_message,
        )
        if result:
            raw_text, response = result
            return response, "groq", raw_text

        # ── Both exhausted → safe fallback ────────────────────────────────────
        log.error("Both Gemini and Groq exhausted — returning fallback_no_llm")
        fallback = AdjudicationResponse.fallback_no_llm("Both Gemini and Groq providers failed")
        return fallback, "fallback_no_llm", ""
