"""Core LLM client with Ollama backend and LiteLLM multi-provider support."""

from __future__ import annotations

import asyncio
import time
from collections.abc import AsyncIterator
from typing import Any, Optional

import litellm
import structlog
from litellm import acompletion, completion
from pydantic import BaseModel, Field

from kotg.core.config import LLMProvider, ModelTier, Settings, get_settings

logger = structlog.get_logger(__name__)

# Suppress LiteLLM verbose output unless debug mode
litellm.suppress_debug_info = True
litellm.set_verbose = False


class Message(BaseModel):
    """A single chat message."""

    role: str = Field(..., description="'system', 'user', or 'assistant'")
    content: str = Field(..., description="Message content")


class LLMResponse(BaseModel):
    """Structured response from LLM."""

    content: str
    model: str
    provider: str
    input_tokens: int = 0
    output_tokens: int = 0
    latency_ms: float = 0.0


class OllamaClient:
    """
    Ollama-backed LLM client with retry logic and streaming.

    Uses LiteLLM as the abstraction layer so provider can be swapped
    to OpenAI / Anthropic / vLLM without changing calling code.
    """

    def __init__(self, settings: Optional[Settings] = None) -> None:
        self._settings = settings or get_settings()
        self._ollama_cfg = self._settings.ollama
        self._model_cfg = self._settings.models

    def _ollama_model_name(self, model: str) -> str:
        """Prefix model name for LiteLLM Ollama routing."""
        if not model.startswith("ollama/"):
            return f"ollama/{model}"
        return model

    def _build_kwargs(self, model: str, **extra: Any) -> dict[str, Any]:
        return {
            "model": self._ollama_model_name(model),
            "api_base": self._ollama_cfg.base_url,
            "timeout": self._ollama_cfg.timeout,
            **extra,
        }

    async def generate(
        self,
        messages: list[Message],
        model: str,
        temperature: float = 0.1,
        max_tokens: int = 2048,
    ) -> LLMResponse:
        """Generate a completion from Ollama, with exponential-backoff retry."""
        lm_messages = [{"role": m.role, "content": m.content} for m in messages]
        kwargs = self._build_kwargs(
            model,
            messages=lm_messages,
            temperature=temperature,
            max_tokens=max_tokens,
        )

        last_error: Exception | None = None
        for attempt in range(self._ollama_cfg.max_retries):
            try:
                t0 = time.monotonic()
                response = await acompletion(**kwargs)
                latency = (time.monotonic() - t0) * 1000

                content = response.choices[0].message.content or ""
                usage = response.usage or {}

                logger.debug(
                    "llm.generate.ok",
                    model=model,
                    tokens_in=getattr(usage, "prompt_tokens", 0),
                    tokens_out=getattr(usage, "completion_tokens", 0),
                    latency_ms=round(latency, 1),
                )

                return LLMResponse(
                    content=content,
                    model=model,
                    provider=LLMProvider.OLLAMA,
                    input_tokens=getattr(usage, "prompt_tokens", 0),
                    output_tokens=getattr(usage, "completion_tokens", 0),
                    latency_ms=round(latency, 1),
                )

            except Exception as exc:
                last_error = exc
                wait = 2**attempt
                logger.warning(
                    "llm.generate.retry",
                    attempt=attempt + 1,
                    max_retries=self._ollama_cfg.max_retries,
                    error=str(exc),
                    wait_s=wait,
                )
                await asyncio.sleep(wait)

        raise RuntimeError(
            f"LLM generate failed after {self._ollama_cfg.max_retries} attempts: {last_error}"
        )

    async def stream(
        self,
        messages: list[Message],
        model: str,
        temperature: float = 0.1,
        max_tokens: int = 2048,
    ) -> AsyncIterator[str]:
        """Stream tokens from Ollama."""
        lm_messages = [{"role": m.role, "content": m.content} for m in messages]
        kwargs = self._build_kwargs(
            model,
            messages=lm_messages,
            temperature=temperature,
            max_tokens=max_tokens,
            stream=True,
        )

        response = await acompletion(**kwargs)
        async for chunk in response:
            delta = chunk.choices[0].delta
            if delta and delta.content:
                yield delta.content

    def generate_sync(
        self,
        messages: list[Message],
        model: str,
        temperature: float = 0.1,
        max_tokens: int = 2048,
    ) -> LLMResponse:
        """Synchronous wrapper for environments without running event loop."""
        lm_messages = [{"role": m.role, "content": m.content} for m in messages]
        kwargs = self._build_kwargs(
            model,
            messages=lm_messages,
            temperature=temperature,
            max_tokens=max_tokens,
        )

        t0 = time.monotonic()
        response = completion(**kwargs)
        latency = (time.monotonic() - t0) * 1000

        content = response.choices[0].message.content or ""
        usage = response.usage or {}

        return LLMResponse(
            content=content,
            model=model,
            provider=LLMProvider.OLLAMA,
            input_tokens=getattr(usage, "prompt_tokens", 0),
            output_tokens=getattr(usage, "completion_tokens", 0),
            latency_ms=round(latency, 1),
        )


class ModelRouter:
    """
    Selects the appropriate model based on task complexity tier.

    Tier routing:
        NANO   → qwen2.5:0.5b  (intent classification, slot filling)
        SMALL  → qwen2.5:3b    (tool selection, YAML generation)
        MEDIUM → llama3.2:8b   (multi-step reasoning, incident diagnosis)
        LARGE  → deepseek-r1:14b (complex architecture analysis)
        EXPERT → deepseek-r1:32b (full cluster reasoning)
    """

    def __init__(self, settings: Optional[Settings] = None) -> None:
        self._settings = settings or get_settings()
        self._cfg = self._settings.models
        self._client = OllamaClient(settings=self._settings)
        self._tier_model_map: dict[ModelTier, str] = {
            ModelTier.NANO: self._cfg.nano_model,
            ModelTier.SMALL: self._cfg.small_model,
            ModelTier.MEDIUM: self._cfg.medium_model,
            ModelTier.LARGE: self._cfg.large_model,
            ModelTier.EXPERT: self._cfg.expert_model,
        }

    def model_for_tier(self, tier: ModelTier) -> str:
        """Return the configured model name for a given tier."""
        return self._tier_model_map[tier]

    async def generate(
        self,
        messages: list[Message],
        tier: ModelTier = ModelTier.MEDIUM,
        temperature: float = 0.1,
        max_tokens: int = 2048,
    ) -> LLMResponse:
        """Generate using the model for the specified tier."""
        model = self.model_for_tier(tier)
        logger.debug("model_router.generate", tier=tier.value, model=model)
        return await self._client.generate(
            messages=messages,
            model=model,
            temperature=temperature,
            max_tokens=max_tokens,
        )

    async def stream(
        self,
        messages: list[Message],
        tier: ModelTier = ModelTier.MEDIUM,
        temperature: float = 0.1,
        max_tokens: int = 2048,
    ) -> AsyncIterator[str]:
        """Stream tokens using the model for the specified tier."""
        model = self.model_for_tier(tier)
        async for token in self._client.stream(
            messages=messages,
            model=model,
            temperature=temperature,
            max_tokens=max_tokens,
        ):
            yield token

    def classify_complexity(self, query: str) -> ModelTier:
        """
        Heuristic complexity classifier — routes to correct tier without LLM call.

        In production this would use the NANO model for classification.
        For now: keyword / length heuristic.
        """
        query_lower = query.lower()

        # Keywords indicating high complexity
        expert_keywords = {
            "architecture", "federation", "etcd", "raft", "ebpf", "kprobe",
            "cni", "packet drop", "split-brain", "performance tuning",
        }
        large_keywords = {
            "optimize", "audit", "compliance", "security policy", "opa", "gatekeeper",
            "multi-cluster", "cost analysis", "forecast",
        }
        medium_keywords = {
            "diagnose", "debug", "incident", "crashloopbackoff", "oomkilled",
            "evicted", "pending", "imagepullbackoff", "root cause",
        }

        if any(kw in query_lower for kw in expert_keywords):
            return ModelTier.EXPERT
        if any(kw in query_lower for kw in large_keywords):
            return ModelTier.LARGE
        if any(kw in query_lower for kw in medium_keywords):
            return ModelTier.MEDIUM
        if len(query.split()) > 20:
            return ModelTier.MEDIUM
        return ModelTier.SMALL
