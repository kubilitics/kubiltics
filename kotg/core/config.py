"""KOTG.AI configuration management."""

from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class ModelTier(str, Enum):
    """LLM model complexity tiers."""

    NANO = "nano"        # Qwen2.5-0.5B — intent classification
    SMALL = "small"      # Qwen2.5-3B — tool selection, YAML gen
    MEDIUM = "medium"    # Llama-3.2-8B / Qwen2.5-7B — multi-step reasoning
    LARGE = "large"      # DeepSeek-R1-14B — complex analysis
    EXPERT = "expert"    # DeepSeek-R1-32B — full cluster reasoning


class LLMProvider(str, Enum):
    """Supported LLM inference providers."""

    OLLAMA = "ollama"
    OPENAI = "openai"
    ANTHROPIC = "anthropic"
    LITELLM = "litellm"


class OllamaConfig(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="KOTG_OLLAMA_")

    base_url: str = Field(default="http://localhost:11434", description="Ollama API base URL")
    timeout: int = Field(default=120, description="Request timeout in seconds")
    max_retries: int = Field(default=3, description="Max retry attempts")


class ModelConfig(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="KOTG_MODEL_")

    # Tier-to-model mapping
    nano_model: str = Field(default="qwen2.5:0.5b", description="Nano tier model name")
    small_model: str = Field(default="qwen2.5:3b", description="Small tier model name")
    medium_model: str = Field(default="llama3.2:8b", description="Medium tier model name")
    large_model: str = Field(default="deepseek-r1:14b", description="Large tier model name")
    expert_model: str = Field(default="deepseek-r1:32b", description="Expert tier model name")

    # Embedding model
    embedding_model: str = Field(default="nomic-embed-text", description="Embedding model")

    # Default provider
    provider: LLMProvider = Field(default=LLMProvider.OLLAMA, description="Default LLM provider")


class QdrantConfig(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="KOTG_QDRANT_")

    url: str = Field(default="http://localhost:6333", description="Qdrant API URL")
    collection_name: str = Field(default="kotg_knowledge", description="Default collection name")
    api_key: Optional[str] = Field(default=None, description="Qdrant Cloud API key")


class KubeConfig(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="KOTG_KUBE_")

    config_path: Optional[str] = Field(default=None, description="Path to kubeconfig file")
    context: Optional[str] = Field(default=None, description="Kubeconfig context to use")
    in_cluster: bool = Field(default=False, description="Use in-cluster service account")


class Settings(BaseSettings):
    """Top-level KOTG.AI settings."""

    model_config = SettingsConfigDict(
        env_prefix="KOTG_",
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    # Sub-configs
    ollama: OllamaConfig = Field(default_factory=OllamaConfig)
    models: ModelConfig = Field(default_factory=ModelConfig)
    qdrant: QdrantConfig = Field(default_factory=QdrantConfig)
    kube: KubeConfig = Field(default_factory=KubeConfig)

    # App settings
    debug: bool = Field(default=False, description="Enable debug logging")
    log_level: str = Field(default="INFO", description="Log level")
    data_dir: str = Field(default="~/.kotg", description="Data directory for persistent storage")
    api_port: int = Field(default=8080, description="API server port")

    # Optional cloud LLM API keys (for fallback)
    openai_api_key: Optional[str] = Field(default=None, description="OpenAI API key (optional)")
    anthropic_api_key: Optional[str] = Field(
        default=None, description="Anthropic API key (optional)"
    )

    @field_validator("log_level")
    @classmethod
    def validate_log_level(cls, v: str) -> str:
        valid = {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}
        if v.upper() not in valid:
            raise ValueError(f"log_level must be one of {valid}")
        return v.upper()


# Singleton settings instance
_settings: Optional[Settings] = None


def get_settings() -> Settings:
    """Get the global settings singleton."""
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings
