"""Tests for OllamaClient, ModelRouter, and complexity classification."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from kotg.core.config import ModelTier, Settings
from kotg.core.llm import LLMResponse, Message, ModelRouter, OllamaClient


@pytest.fixture()
def settings():
    return Settings()


@pytest.fixture()
def mock_response():
    """Fake LiteLLM completion response."""
    choice = MagicMock()
    choice.message.content = "This pod is crashing due to OOMKilled."
    usage = MagicMock()
    usage.prompt_tokens = 50
    usage.completion_tokens = 20
    response = MagicMock()
    response.choices = [choice]
    response.usage = usage
    return response


class TestOllamaClient:
    async def test_generate_returns_llm_response(self, settings, mock_response):
        client = OllamaClient(settings=settings)

        with patch("kotg.core.llm.acompletion", AsyncMock(return_value=mock_response)):
            result = await client.generate(
                messages=[Message(role="user", content="diagnose crash")],
                model="llama3.2:8b",
            )

        assert isinstance(result, LLMResponse)
        assert "OOMKilled" in result.content
        assert result.model == "llama3.2:8b"
        assert result.input_tokens == 50
        assert result.output_tokens == 20
        assert result.latency_ms >= 0

    async def test_generate_retries_on_failure(self, settings):
        client = OllamaClient(settings=settings)
        client._ollama_cfg.max_retries = 2

        with patch("kotg.core.llm.acompletion", AsyncMock(side_effect=ConnectionError("down"))):
            with patch("asyncio.sleep", AsyncMock()):
                with pytest.raises(RuntimeError, match="failed after"):
                    await client.generate(
                        messages=[Message(role="user", content="test")],
                        model="llama3.2:8b",
                    )

    def test_ollama_model_name_prefix(self, settings):
        client = OllamaClient(settings=settings)
        assert client._ollama_model_name("llama3.2:8b") == "ollama/llama3.2:8b"
        assert client._ollama_model_name("ollama/already") == "ollama/already"


class TestModelRouter:
    def test_model_for_tier(self, settings):
        router = ModelRouter(settings=settings)
        assert router.model_for_tier(ModelTier.NANO) == settings.models.nano_model
        assert router.model_for_tier(ModelTier.SMALL) == settings.models.small_model
        assert router.model_for_tier(ModelTier.MEDIUM) == settings.models.medium_model

    async def test_generate_uses_correct_tier_model(self, settings, mock_response):
        router = ModelRouter(settings=settings)

        with patch("kotg.core.llm.acompletion", AsyncMock(return_value=mock_response)) as mock_ac:
            await router.generate(
                messages=[Message(role="user", content="test")],
                tier=ModelTier.SMALL,
            )
            call_kwargs = mock_ac.call_args.kwargs
            assert settings.models.small_model in call_kwargs["model"]

    def test_classify_complexity_diagnose(self, settings):
        router = ModelRouter(settings=settings)
        tier = router.classify_complexity("my pod is in CrashLoopBackOff")
        assert tier == ModelTier.MEDIUM

    def test_classify_complexity_expert(self, settings):
        router = ModelRouter(settings=settings)
        tier = router.classify_complexity("diagnose etcd raft split-brain issue")
        assert tier == ModelTier.EXPERT

    def test_classify_complexity_small_simple(self, settings):
        router = ModelRouter(settings=settings)
        tier = router.classify_complexity("what is a pod?")
        assert tier == ModelTier.SMALL

    def test_classify_complexity_large(self, settings):
        router = ModelRouter(settings=settings)
        tier = router.classify_complexity("run security audit and OPA compliance check")
        assert tier == ModelTier.LARGE
