"""Tests for kubectl MCP tools — injection prevention and correct arg building."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from kotg.mcp.base import MCPToolRegistry, ToolResult
from kotg.mcp.kubectl import (
    KubectlDescribeTool,
    KubectlEventsTool,
    KubectlGetTool,
    KubectlLogsTool,
    _sanitize_kubectl_args,
    build_kubectl_registry,
)


# ---------------------------------------------------------------------------
# Sanitizer tests
# ---------------------------------------------------------------------------

class TestSanitizeKubectlArgs:
    def test_allows_safe_verbs(self):
        for verb in ["get", "describe", "logs", "top", "explain"]:
            args = _sanitize_kubectl_args(f"{verb} pods")
            assert args[0] == verb

    def test_blocks_dangerous_verbs(self):
        for verb in ["apply", "delete", "exec", "run", "patch", "drain"]:
            with pytest.raises(ValueError, match="not allowed"):
                _sanitize_kubectl_args(f"{verb} pods")

    def test_blocks_shell_metacharacters(self):
        for payload in [
            "get pods; rm -rf /",
            "get pods | cat /etc/passwd",
            "get pods && evil",
            "get pods `whoami`",
            "get pods $(id)",
        ]:
            with pytest.raises(ValueError, match="metacharacters"):
                _sanitize_kubectl_args(payload)

    def test_empty_args_raises(self):
        with pytest.raises(ValueError, match="Empty"):
            _sanitize_kubectl_args("")


# ---------------------------------------------------------------------------
# KubectlGetTool
# ---------------------------------------------------------------------------

class TestKubectlGetTool:
    @pytest.fixture()
    def tool(self):
        return KubectlGetTool()

    async def test_execute_basic(self, tool):
        mock_run = AsyncMock(return_value=("NAME  STATUS\nmy-pod  Running\n", "", 0))

        with patch("kotg.mcp.kubectl._run_kubectl", mock_run):
            result = await tool.execute({"resource": "pods"})

        assert result.success
        assert "my-pod" in result.output
        args_used = mock_run.call_args[0][0]
        assert args_used[0] == "get"
        assert "pods" in args_used

    async def test_execute_with_namespace(self, tool):
        mock_run = AsyncMock(return_value=("output", "", 0))

        with patch("kotg.mcp.kubectl._run_kubectl", mock_run):
            await tool.execute({"resource": "pods", "namespace": "production"})

        args_used = mock_run.call_args[0][0]
        assert "-n" in args_used
        assert "production" in args_used

    async def test_execute_failure_returns_error(self, tool):
        mock_run = AsyncMock(return_value=("", "Error from server: not found", 1))

        with patch("kotg.mcp.kubectl._run_kubectl", mock_run):
            result = await tool.execute({"resource": "pods/nonexistent"})

        assert not result.success
        assert result.error is not None

    def test_tier_is_read_only(self, tool):
        assert tool.definition.tier == 1

    def test_required_args(self, tool):
        with pytest.raises(ValueError, match="Missing required"):
            tool.validate_args({})


# ---------------------------------------------------------------------------
# KubectlLogsTool
# ---------------------------------------------------------------------------

class TestKubectlLogsTool:
    @pytest.fixture()
    def tool(self):
        return KubectlLogsTool()

    async def test_execute_with_previous_flag(self, tool):
        mock_run = AsyncMock(return_value=("OOMKilled logs...", "", 0))

        with patch("kotg.mcp.kubectl._run_kubectl", mock_run):
            result = await tool.execute({
                "pod": "crashed-pod",
                "namespace": "default",
                "previous": True,
                "tail": 50,
            })

        assert result.success
        args = mock_run.call_args[0][0]
        assert "--previous" in args
        assert "50" in args


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------

class TestMCPToolRegistry:
    def test_build_kubectl_registry(self):
        registry = build_kubectl_registry()
        tools = registry.list_tools()
        names = {t.name for t in tools}
        assert "kubectl_get" in names
        assert "kubectl_describe" in names
        assert "kubectl_logs" in names
        assert "kubectl_events" in names
        assert "kubectl_top" in names

    async def test_tier4_blocked(self):
        from kotg.mcp.base import MCPTool, ToolDefinition, ToolResult, ToolSchema

        class FakeTier4Tool(MCPTool):
            @property
            def definition(self):
                return ToolDefinition(
                    name="dangerous_delete",
                    description="Deletes everything",
                    tier=4,
                )

            async def execute(self, args):
                return ToolResult(tool="dangerous_delete", output="DELETED ALL")

        registry = MCPToolRegistry()
        registry.register(FakeTier4Tool())

        with pytest.raises(PermissionError):
            await registry.call("dangerous_delete", {})

    async def test_tier4_allowed_with_confirmed(self):
        from kotg.mcp.base import MCPTool, ToolDefinition, ToolResult

        class FakeTier4Tool(MCPTool):
            @property
            def definition(self):
                return ToolDefinition(name="safe_exec", description="test", tier=4)

            async def execute(self, args):
                return ToolResult(tool="safe_exec", output="done")

        registry = MCPToolRegistry()
        registry.register(FakeTier4Tool())

        result = await registry.execute_unsafe("safe_exec", {}, confirmed=True)
        assert result.success

    def test_unknown_tool_raises_key_error(self):
        registry = MCPToolRegistry()
        with pytest.raises(KeyError, match="Unknown"):
            registry.get("nonexistent_tool")
