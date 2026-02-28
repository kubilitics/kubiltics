"""
KOTG.AI Kubernetes Diagnosis Agent.

Uses LangGraph for stateful multi-step reasoning with MCP tool calls.
Architecture:
  User Query
      │
      ▼
  Intent Classifier (NANO model)
      │
      ├─ diagnose → Diagnosis Agent (MEDIUM model + MCP tools)
      ├─ explain  → Explanation Agent (SMALL model + RAG)
      ├─ generate → YAML Generator (SMALL model)
      └─ analyze  → Analysis Agent (LARGE model)
"""

from __future__ import annotations

import json
from enum import Enum
from typing import Any, Optional

import structlog
from pydantic import BaseModel, Field

from kotg.core.config import ModelTier, get_settings
from kotg.core.llm import Message, ModelRouter
from kotg.core.prompts import KotgPrompts
from kotg.mcp.base import MCPToolRegistry, ToolResult

logger = structlog.get_logger(__name__)


class Intent(str, Enum):
    """Classified intent of a user query."""

    DIAGNOSE = "diagnose"
    EXPLAIN = "explain"
    GENERATE = "generate"
    ANALYZE = "analyze"
    EXECUTE = "execute"
    GENERAL = "general"


class AgentState(BaseModel):
    """Mutable state passed through the LangGraph agent graph."""

    query: str
    intent: Optional[Intent] = None
    cluster_context: str = ""
    tool_results: list[ToolResult] = Field(default_factory=list)
    messages: list[Message] = Field(default_factory=list)
    final_response: str = ""
    steps: list[str] = Field(default_factory=list)
    error: Optional[str] = None


class DiagnosisStep(BaseModel):
    """A single step in a multi-step diagnosis plan."""

    step_number: int
    action: str  # "call_tool" | "reason" | "summarize"
    tool_name: Optional[str] = None
    tool_args: dict[str, Any] = Field(default_factory=dict)
    reasoning: str = ""


class KubernetesAgent:
    """
    Multi-step Kubernetes diagnosis agent.

    Implements a ReAct (Reason + Act) loop:
    1. Classify intent
    2. Plan tool calls
    3. Execute tools (kubectl MCP)
    4. Synthesize diagnosis
    5. Return structured response
    """

    MAX_TOOL_CALLS = 8  # Prevent infinite loops
    MAX_REASONING_STEPS = 5

    def __init__(
        self,
        registry: MCPToolRegistry,
        router: Optional[ModelRouter] = None,
    ) -> None:
        self._registry = registry
        self._router = router or ModelRouter()

    async def run(self, query: str, cluster_context: str = "") -> AgentState:
        """
        Run the full agent pipeline for a user query.

        Returns the final AgentState with diagnosis and tool results.
        """
        state = AgentState(query=query, cluster_context=cluster_context)

        # Step 1: Classify intent
        state = await self._classify_intent(state)
        logger.info("agent.intent", intent=state.intent, query=query[:80])

        # Step 2: Route to appropriate handler
        match state.intent:
            case Intent.DIAGNOSE:
                state = await self._run_diagnosis(state)
            case Intent.GENERATE:
                state = await self._run_yaml_generation(state)
            case Intent.EXPLAIN | Intent.GENERAL:
                state = await self._run_explanation(state)
            case Intent.ANALYZE:
                state = await self._run_analysis(state)
            case Intent.EXECUTE:
                state.final_response = (
                    "⚠️  Execution operations require explicit confirmation and are not "
                    "enabled in this session. Use `kotg execute --confirm` to enable "
                    "Tier 4 execution tools."
                )
            case _:
                state = await self._run_explanation(state)

        return state

    # ---------------------------------------------------------------------------
    # Intent classification
    # ---------------------------------------------------------------------------

    async def _classify_intent(self, state: AgentState) -> AgentState:
        """Use NANO model to classify query intent."""
        messages = KotgPrompts.intent_messages(state.query)
        try:
            response = await self._router.generate(messages, tier=ModelTier.NANO, max_tokens=10)
            raw = response.content.strip().lower()
            try:
                state.intent = Intent(raw)
            except ValueError:
                # Fallback: heuristic
                state.intent = Intent.DIAGNOSE if "error" in state.query.lower() else Intent.GENERAL
        except Exception as exc:
            logger.warning("agent.classify_intent.fallback", error=str(exc))
            state.intent = self._heuristic_intent(state.query)

        state.steps.append(f"Classified intent: {state.intent}")
        return state

    def _heuristic_intent(self, query: str) -> Intent:
        """Fallback intent classification without LLM."""
        q = query.lower()
        if any(w in q for w in ["debug", "crash", "error", "failed", "pending", "diagnose"]):
            return Intent.DIAGNOSE
        if any(w in q for w in ["yaml", "manifest", "create", "generate", "template"]):
            return Intent.GENERATE
        if any(w in q for w in ["analyze", "audit", "cost", "security", "performance"]):
            return Intent.ANALYZE
        return Intent.EXPLAIN

    # ---------------------------------------------------------------------------
    # Diagnosis handler — ReAct loop with MCP tools
    # ---------------------------------------------------------------------------

    async def _run_diagnosis(self, state: AgentState) -> AgentState:
        """
        Run multi-step ReAct diagnosis loop.

        1. Ask LLM what tools to call
        2. Execute tools
        3. Feed results back to LLM
        4. Repeat until diagnosis complete
        """
        state.steps.append("Starting diagnosis with ReAct loop")
        available_tools = self._registry.list_tools()
        tools_desc = "\n".join(
            f"- {t.name}: {t.description}" for t in available_tools if t.tier <= 2
        )

        for iteration in range(self.MAX_TOOL_CALLS):
            # Build context from tool results so far
            context_parts = []
            if state.cluster_context:
                context_parts.append(f"Cluster context:\n{state.cluster_context}")
            if state.tool_results:
                context_parts.append("Tool results so far:")
                for tr in state.tool_results:
                    context_parts.append(tr.as_context_string())

            context = "\n\n".join(context_parts)

            # Prompt LLM to decide next action
            plan_prompt = f"""You are diagnosing a Kubernetes issue: {state.query}

Available tools:
{tools_desc}

{context if context else "No tool results yet."}

Decide your next action. Respond with JSON in one of these formats:

To call a tool:
{{"action": "call_tool", "tool": "<tool_name>", "args": {{...}}, "reasoning": "<why>"}}

When you have enough information to provide a complete diagnosis:
{{"action": "complete", "reasoning": "<summary of findings>"}}"""

            messages = [
                Message(role="system", content="You are an expert Kubernetes SRE. Respond ONLY with the requested JSON."),
                Message(role="user", content=plan_prompt),
            ]

            try:
                response = await self._router.generate(
                    messages, tier=ModelTier.MEDIUM, max_tokens=512, temperature=0.05
                )
                decision = self._parse_json_response(response.content)
            except Exception as exc:
                logger.warning("agent.diagnosis.parse_error", error=str(exc), iteration=iteration)
                break

            action = decision.get("action", "complete")
            reasoning = decision.get("reasoning", "")
            state.steps.append(f"Step {iteration + 1}: {action} — {reasoning[:80]}")

            if action == "complete":
                logger.debug("agent.diagnosis.complete", iterations=iteration + 1)
                break

            if action == "call_tool":
                tool_name = decision.get("tool", "")
                tool_args = decision.get("args", {})

                try:
                    result = await self._registry.call(tool_name, tool_args)
                    state.tool_results.append(result)
                    logger.debug(
                        "agent.tool_call",
                        tool=tool_name,
                        success=result.success,
                        output_len=len(result.output),
                    )
                except (KeyError, ValueError, PermissionError) as exc:
                    state.tool_results.append(
                        ToolResult(
                            tool=tool_name,
                            output="",
                            success=False,
                            error=str(exc),
                        )
                    )

        # Final synthesis
        state = await self._synthesize_diagnosis(state)
        return state

    async def _synthesize_diagnosis(self, state: AgentState) -> AgentState:
        """Generate final diagnosis from accumulated tool results."""
        tool_results_dicts = [
            {"tool": tr.tool, "output": tr.output if tr.success else f"ERROR: {tr.error}"}
            for tr in state.tool_results
        ]

        messages = KotgPrompts.diagnose_messages(
            query=state.query,
            cluster_context=state.cluster_context,
            tool_results=tool_results_dicts,
        )

        response = await self._router.generate(
            messages, tier=ModelTier.MEDIUM, max_tokens=2048, temperature=0.1
        )
        state.final_response = response.content
        return state

    # ---------------------------------------------------------------------------
    # Other handlers
    # ---------------------------------------------------------------------------

    async def _run_yaml_generation(self, state: AgentState) -> AgentState:
        """Generate Kubernetes YAML manifests."""
        messages = KotgPrompts.yaml_messages(request=state.query)
        response = await self._router.generate(
            messages, tier=ModelTier.SMALL, max_tokens=2048, temperature=0.05
        )
        state.final_response = response.content
        state.steps.append("Generated YAML manifest")
        return state

    async def _run_explanation(self, state: AgentState) -> AgentState:
        """Explain a Kubernetes concept or resource."""
        messages = [
            Message(
                role="system",
                content=(
                    "You are an expert Kubernetes instructor. Provide clear, accurate "
                    "explanations with practical examples. Be concise but thorough."
                ),
            ),
            Message(role="user", content=state.query),
        ]
        response = await self._router.generate(
            messages, tier=ModelTier.SMALL, max_tokens=1024, temperature=0.2
        )
        state.final_response = response.content
        state.steps.append("Generated explanation")
        return state

    async def _run_analysis(self, state: AgentState) -> AgentState:
        """Deep analysis (cost, security, performance)."""
        messages = [
            Message(
                role="system",
                content=(
                    "You are a Kubernetes architect specializing in cost optimization, "
                    "security hardening, and performance tuning. Provide detailed analysis "
                    "with specific recommendations and kubectl/YAML examples."
                ),
            ),
            Message(role="user", content=state.query),
        ]
        response = await self._router.generate(
            messages, tier=ModelTier.LARGE, max_tokens=3000, temperature=0.1
        )
        state.final_response = response.content
        state.steps.append("Generated analysis")
        return state

    # ---------------------------------------------------------------------------
    # Utilities
    # ---------------------------------------------------------------------------

    @staticmethod
    def _parse_json_response(content: str) -> dict[str, Any]:
        """Extract JSON from LLM response, handling markdown code blocks."""
        content = content.strip()
        # Strip markdown code fences
        if content.startswith("```"):
            lines = content.split("\n")
            content = "\n".join(lines[1:-1] if lines[-1] == "```" else lines[1:])
        return json.loads(content)
