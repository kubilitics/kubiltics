"""KOTG.AI core layer — LLM client, model routing, config, prompts."""

from kotg.core.config import ModelTier, Settings, get_settings
from kotg.core.llm import LLMResponse, Message, ModelRouter, OllamaClient
from kotg.core.prompts import KotgPrompts

__all__ = [
    "get_settings",
    "Settings",
    "ModelTier",
    "OllamaClient",
    "ModelRouter",
    "Message",
    "LLMResponse",
    "KotgPrompts",
]
