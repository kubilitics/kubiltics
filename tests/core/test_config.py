"""Tests for KOTG.AI configuration management."""

import os
import pytest
from kotg.core.config import (
    LLMProvider,
    ModelTier,
    Settings,
    get_settings,
)


def test_default_settings():
    """Default settings should load without errors."""
    settings = Settings()
    assert settings.models.provider == LLMProvider.OLLAMA
    assert settings.models.nano_model == "qwen2.5:0.5b"
    assert settings.models.small_model == "qwen2.5:3b"
    assert settings.models.medium_model == "llama3.2:8b"
    assert settings.api_port == 8080
    assert settings.log_level == "INFO"


def test_model_tier_enum():
    """ModelTier enum should have all expected values."""
    assert ModelTier.NANO == "nano"
    assert ModelTier.SMALL == "small"
    assert ModelTier.MEDIUM == "medium"
    assert ModelTier.LARGE == "large"
    assert ModelTier.EXPERT == "expert"


def test_llm_provider_enum():
    """LLMProvider enum should include all supported backends."""
    assert LLMProvider.OLLAMA == "ollama"
    assert LLMProvider.OPENAI == "openai"
    assert LLMProvider.ANTHROPIC == "anthropic"


def test_log_level_validation():
    """Invalid log levels should raise a validation error."""
    with pytest.raises(Exception):
        Settings(log_level="INVALID")


def test_valid_log_levels():
    """Valid log levels should be accepted (case-insensitive)."""
    for level in ["debug", "INFO", "Warning", "ERROR", "CRITICAL"]:
        s = Settings(log_level=level)
        assert s.log_level == level.upper()


def test_settings_singleton():
    """get_settings() should return the same instance."""
    s1 = get_settings()
    s2 = get_settings()
    assert s1 is s2
