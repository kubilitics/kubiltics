"""MCP (Model Context Protocol) base types and client interface."""

from __future__ import annotations

import json
from abc import ABC, abstractmethod
from typing import Any, Optional

from pydantic import BaseModel, Field


class ToolSchema(BaseModel):
    """JSON Schema for a tool's input parameters."""

    type: str = "object"
    properties: dict[str, Any] = Field(default_factory=dict)
    required: list[str] = Field(default_factory=list)


class ToolDefinition(BaseModel):
    """An MCP tool definition with schema and tier metadata."""

    name: str
    description: str
    input_schema: ToolSchema = Field(default_factory=ToolSchema)
    tier: int = Field(default=1, ge=1, le=4, description="Safety tier: 1=read, 4=destructive")
    requires_confirmation: bool = Field(
        default=False, description="Tier 4 tools require explicit user confirmation"
    )


class ToolResult(BaseModel):
    """Structured result from a tool call."""

    tool: str
    output: str
    success: bool = True
    error: Optional[str] = None
    metadata: dict[str, Any] = Field(default_factory=dict)

    def as_context_string(self) -> str:
        """Format result for LLM context injection."""
        if self.success:
            return f"[{self.tool}]\n{self.output}"
        return f"[{self.tool} ERROR]\n{self.error}"


class MCPTool(ABC):
    """Abstract base for all MCP tools."""

    @property
    @abstractmethod
    def definition(self) -> ToolDefinition:
        """Return the tool's definition and schema."""

    @abstractmethod
    async def execute(self, args: dict[str, Any]) -> ToolResult:
        """Execute the tool with validated arguments."""

    def validate_args(self, args: dict[str, Any]) -> None:
        """Validate args against the tool's JSON schema."""
        schema = self.definition.input_schema
        missing = [k for k in schema.required if k not in args]
        if missing:
            raise ValueError(f"Missing required arguments for {self.definition.name}: {missing}")


class MCPToolRegistry:
    """Central registry for all available MCP tools."""

    def __init__(self) -> None:
        self._tools: dict[str, MCPTool] = {}

    def register(self, tool: MCPTool) -> None:
        """Register a tool by name."""
        self._tools[tool.definition.name] = tool

    def get(self, name: str) -> MCPTool:
        """Look up a tool by name, raising KeyError if not found."""
        if name not in self._tools:
            raise KeyError(f"Unknown MCP tool: '{name}'. Available: {list(self._tools)}")
        return self._tools[name]

    def list_tools(self) -> list[ToolDefinition]:
        """Return definitions of all registered tools."""
        return [t.definition for t in self._tools.values()]

    async def call(self, name: str, args: dict[str, Any]) -> ToolResult:
        """Validate and execute a tool call."""
        tool = self.get(name)
        tool.validate_args(args)

        # Tier 4 tools must be explicitly requested via execute_unsafe
        if tool.definition.tier == 4:
            raise PermissionError(
                f"Tool '{name}' is a Tier 4 (execution) tool. "
                "Use execute_unsafe() with explicit user confirmation."
            )
        return await tool.execute(args)

    async def execute_unsafe(
        self,
        name: str,
        args: dict[str, Any],
        confirmed: bool = False,
    ) -> ToolResult:
        """Execute a Tier 4 tool — requires explicit confirmation flag."""
        if not confirmed:
            raise PermissionError(
                f"Tier 4 tool '{name}' requires confirmed=True. "
                "This will make changes to the cluster."
            )
        tool = self.get(name)
        tool.validate_args(args)
        return await tool.execute(args)

    def to_llm_tools(self) -> list[dict[str, Any]]:
        """Export tool definitions in OpenAI function-calling format."""
        result = []
        for defn in self.list_tools():
            result.append({
                "type": "function",
                "function": {
                    "name": defn.name,
                    "description": defn.description,
                    "parameters": defn.input_schema.model_dump(),
                },
            })
        return result
