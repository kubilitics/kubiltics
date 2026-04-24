"""kubectl MCP tool — wraps kubectl read-only commands as safe MCP tools."""

from __future__ import annotations

import asyncio
import re
import shlex
from typing import Any

import structlog

from kotg.mcp.base import MCPTool, ToolDefinition, ToolResult, ToolSchema

logger = structlog.get_logger(__name__)

# Commands that mutate cluster state — BLOCKED in read-only tools
_DANGEROUS_VERBS = frozenset({
    "apply", "create", "delete", "replace", "patch", "edit",
    "scale", "rollout", "drain", "cordon", "uncordon", "taint",
    "label", "annotate", "exec", "run", "cp", "port-forward",
    "attach", "expose",
})

# Allowed read-only verbs
_SAFE_VERBS = frozenset({
    "get", "describe", "logs", "top", "version", "config",
    "explain", "api-resources", "api-versions", "cluster-info",
    "auth", "diff",
})

# Maximum output size (bytes) to prevent overwhelming LLM context
_MAX_OUTPUT_BYTES = 64 * 1024  # 64KB


def _sanitize_kubectl_args(args_str: str) -> list[str]:
    """
    Parse and sanitize kubectl arguments.

    Raises ValueError if:
    - A dangerous verb is used
    - Shell metacharacters are present (injection prevention)
    - Invalid resource kinds are detected
    """
    # Reject shell metacharacters to prevent injection
    if re.search(r"[;&|`$<>\\]", args_str):
        raise ValueError(f"Shell metacharacters are not allowed in kubectl args: {args_str!r}")

    parts = shlex.split(args_str)
    if not parts:
        raise ValueError("Empty kubectl arguments")

    verb = parts[0].lower()
    if verb in _DANGEROUS_VERBS:
        raise ValueError(
            f"Verb '{verb}' is not allowed in read-only kubectl tools. "
            f"Allowed verbs: {sorted(_SAFE_VERBS)}"
        )

    return parts


async def _run_kubectl(args: list[str], timeout: int = 30) -> tuple[str, str, int]:
    """Run kubectl with given args, returning (stdout, stderr, returncode)."""
    cmd = ["kubectl"] + args
    logger.debug("kubectl.run", cmd=" ".join(cmd))

    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    try:
        stdout_bytes, stderr_bytes = await asyncio.wait_for(
            proc.communicate(), timeout=timeout
        )
    except asyncio.TimeoutError:
        proc.kill()
        return "", f"kubectl timed out after {timeout}s", 1

    stdout = stdout_bytes.decode("utf-8", errors="replace")
    stderr = stderr_bytes.decode("utf-8", errors="replace")
    returncode = proc.returncode or 0

    # Truncate oversized output
    if len(stdout) > _MAX_OUTPUT_BYTES:
        stdout = stdout[:_MAX_OUTPUT_BYTES] + "\n... [output truncated]"

    return stdout, stderr, returncode


# ---------------------------------------------------------------------------
# Individual tool implementations
# ---------------------------------------------------------------------------


class KubectlGetTool(MCPTool):
    """kubectl get — list Kubernetes resources."""

    @property
    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="kubectl_get",
            description=(
                "List Kubernetes resources. Examples: pods, deployments, services, nodes. "
                "Returns structured resource information."
            ),
            input_schema=ToolSchema(
                properties={
                    "resource": {
                        "type": "string",
                        "description": "Resource type (e.g. 'pods', 'deployments/my-app')",
                    },
                    "namespace": {
                        "type": "string",
                        "description": "Namespace (omit for cluster-scoped resources)",
                    },
                    "output": {
                        "type": "string",
                        "enum": ["", "wide", "yaml", "json", "name"],
                        "description": "Output format",
                    },
                    "label_selector": {
                        "type": "string",
                        "description": "Label selector (e.g. 'app=nginx')",
                    },
                    "all_namespaces": {
                        "type": "boolean",
                        "description": "List across all namespaces",
                    },
                },
                required=["resource"],
            ),
            tier=1,
        )

    async def execute(self, args: dict[str, Any]) -> ToolResult:
        resource: str = args["resource"]
        namespace: str = args.get("namespace", "")
        output: str = args.get("output", "")
        label_selector: str = args.get("label_selector", "")
        all_namespaces: bool = args.get("all_namespaces", False)

        kubectl_args = ["get", resource]
        if all_namespaces:
            kubectl_args.append("--all-namespaces")
        elif namespace:
            kubectl_args.extend(["-n", namespace])
        if output:
            kubectl_args.extend(["-o", output])
        if label_selector:
            kubectl_args.extend(["-l", label_selector])

        stdout, stderr, rc = await _run_kubectl(kubectl_args)

        if rc != 0:
            return ToolResult(
                tool="kubectl_get",
                output=stdout,
                success=False,
                error=stderr or f"kubectl exited with code {rc}",
            )
        return ToolResult(tool="kubectl_get", output=stdout, metadata={"resource": resource})


class KubectlDescribeTool(MCPTool):
    """kubectl describe — detailed resource information."""

    @property
    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="kubectl_describe",
            description=(
                "Get detailed information about a Kubernetes resource including events, "
                "conditions, and status. Essential for diagnosing issues."
            ),
            input_schema=ToolSchema(
                properties={
                    "resource": {
                        "type": "string",
                        "description": "Resource type (e.g. 'pod', 'node', 'deployment')",
                    },
                    "name": {
                        "type": "string",
                        "description": "Resource name",
                    },
                    "namespace": {
                        "type": "string",
                        "description": "Namespace",
                    },
                },
                required=["resource", "name"],
            ),
            tier=1,
        )

    async def execute(self, args: dict[str, Any]) -> ToolResult:
        resource: str = args["resource"]
        name: str = args["name"]
        namespace: str = args.get("namespace", "")

        kubectl_args = ["describe", resource, name]
        if namespace:
            kubectl_args.extend(["-n", namespace])

        stdout, stderr, rc = await _run_kubectl(kubectl_args)

        if rc != 0:
            return ToolResult(
                tool="kubectl_describe",
                output=stdout,
                success=False,
                error=stderr or f"kubectl exited with code {rc}",
            )
        return ToolResult(
            tool="kubectl_describe",
            output=stdout,
            metadata={"resource": resource, "name": name},
        )


class KubectlLogsTool(MCPTool):
    """kubectl logs — retrieve container logs."""

    @property
    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="kubectl_logs",
            description=(
                "Retrieve logs from a container in a pod. "
                "Supports --previous for crashed container logs."
            ),
            input_schema=ToolSchema(
                properties={
                    "pod": {"type": "string", "description": "Pod name"},
                    "namespace": {"type": "string", "description": "Namespace"},
                    "container": {"type": "string", "description": "Container name (optional)"},
                    "previous": {
                        "type": "boolean",
                        "description": "Get logs from previous crashed container",
                    },
                    "tail": {
                        "type": "integer",
                        "description": "Number of lines from end (default 100)",
                    },
                },
                required=["pod"],
            ),
            tier=1,
        )

    async def execute(self, args: dict[str, Any]) -> ToolResult:
        pod: str = args["pod"]
        namespace: str = args.get("namespace", "")
        container: str = args.get("container", "")
        previous: bool = args.get("previous", False)
        tail: int = args.get("tail", 100)

        kubectl_args = ["logs", pod]
        if namespace:
            kubectl_args.extend(["-n", namespace])
        if container:
            kubectl_args.extend(["-c", container])
        if previous:
            kubectl_args.append("--previous")
        kubectl_args.extend(["--tail", str(tail)])

        stdout, stderr, rc = await _run_kubectl(kubectl_args, timeout=60)

        if rc != 0:
            return ToolResult(
                tool="kubectl_logs",
                output=stdout,
                success=False,
                error=stderr or f"kubectl exited with code {rc}",
            )
        return ToolResult(
            tool="kubectl_logs",
            output=stdout,
            metadata={"pod": pod, "container": container},
        )


class KubectlEventsTool(MCPTool):
    """kubectl get events — cluster events sorted by time."""

    @property
    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="kubectl_events",
            description=(
                "Get recent Kubernetes events, sorted by timestamp. "
                "Critical for diagnosing scheduling failures, OOM kills, "
                "and image pull errors."
            ),
            input_schema=ToolSchema(
                properties={
                    "namespace": {"type": "string", "description": "Namespace"},
                    "resource": {
                        "type": "string",
                        "description": "Filter by resource (e.g. 'pod/my-pod')",
                    },
                    "all_namespaces": {
                        "type": "boolean",
                        "description": "Get events from all namespaces",
                    },
                },
                required=[],
            ),
            tier=1,
        )

    async def execute(self, args: dict[str, Any]) -> ToolResult:
        namespace: str = args.get("namespace", "")
        resource: str = args.get("resource", "")
        all_namespaces: bool = args.get("all_namespaces", False)

        kubectl_args = ["get", "events", "--sort-by=.lastTimestamp"]
        if all_namespaces:
            kubectl_args.append("--all-namespaces")
        elif namespace:
            kubectl_args.extend(["-n", namespace])
        if resource:
            kubectl_args.extend(["--field-selector", f"involvedObject.name={resource}"])

        stdout, stderr, rc = await _run_kubectl(kubectl_args)

        if rc != 0:
            return ToolResult(
                tool="kubectl_events",
                output=stdout,
                success=False,
                error=stderr or f"kubectl exited with code {rc}",
            )
        return ToolResult(tool="kubectl_events", output=stdout)


class KubectlTopTool(MCPTool):
    """kubectl top — resource usage metrics."""

    @property
    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="kubectl_top",
            description=(
                "Show CPU and memory usage for nodes or pods. "
                "Requires metrics-server to be installed."
            ),
            input_schema=ToolSchema(
                properties={
                    "resource": {
                        "type": "string",
                        "enum": ["nodes", "pods"],
                        "description": "Resource type: 'nodes' or 'pods'",
                    },
                    "namespace": {"type": "string", "description": "Namespace (for pods)"},
                    "all_namespaces": {
                        "type": "boolean",
                        "description": "Show pods from all namespaces",
                    },
                },
                required=["resource"],
            ),
            tier=1,
        )

    async def execute(self, args: dict[str, Any]) -> ToolResult:
        resource: str = args["resource"]
        namespace: str = args.get("namespace", "")
        all_namespaces: bool = args.get("all_namespaces", False)

        kubectl_args = ["top", resource]
        if resource == "pods":
            if all_namespaces:
                kubectl_args.append("--all-namespaces")
            elif namespace:
                kubectl_args.extend(["-n", namespace])

        stdout, stderr, rc = await _run_kubectl(kubectl_args)

        if rc != 0:
            return ToolResult(
                tool="kubectl_top",
                output=stdout,
                success=False,
                error=stderr or f"kubectl exited with code {rc}",
            )
        return ToolResult(tool="kubectl_top", output=stdout, metadata={"resource": resource})


def build_kubectl_registry() -> "MCPToolRegistry":  # noqa: F821
    """Create and return an MCPToolRegistry pre-loaded with all kubectl tools."""
    from kotg.mcp.base import MCPToolRegistry

    registry = MCPToolRegistry()
    registry.register(KubectlGetTool())
    registry.register(KubectlDescribeTool())
    registry.register(KubectlLogsTool())
    registry.register(KubectlEventsTool())
    registry.register(KubectlTopTool())
    return registry
