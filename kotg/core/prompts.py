"""Prompt template management using Jinja2."""

from __future__ import annotations

from typing import Any

from jinja2 import Environment, StrictUndefined

from kotg.core.llm import Message

# Jinja2 environment — strict so missing variables raise errors immediately
_env = Environment(undefined=StrictUndefined, autoescape=False)


# ---------------------------------------------------------------------------
# Prompt templates
# ---------------------------------------------------------------------------

SYSTEM_KUBERNETES_EXPERT = """You are KOTG.AI — an expert Kubernetes SRE assistant with the
combined knowledge of 100+ world-class Kubernetes engineers. You have deep expertise in:

- Kubernetes internals: scheduler, kubelet, etcd, API server, controller-manager
- Networking: CNI plugins, Service mesh (Istio/Linkerd), NetworkPolicies, eBPF
- Storage: PV/PVC lifecycle, CSI drivers, StatefulSet patterns
- Security: RBAC, OPA/Gatekeeper, Pod Security Standards, Secrets management
- Observability: Prometheus, Grafana, OpenTelemetry, distributed tracing
- Cost optimization: resource requests/limits, HPA/VPA, Spot/Preemptible nodes
- Production incidents: CrashLoopBackOff, OOMKilled, ImagePullBackOff, eviction storms

Always provide:
1. Clear, actionable diagnosis
2. Step-by-step remediation commands (kubectl, YAML patches)
3. Root cause explanation
4. Prevention recommendations

Current cluster context:
{{ cluster_context | default("No cluster context available — running in offline mode.") }}"""

DIAGNOSE_TEMPLATE = """{{ system_prompt }}

## User Query
{{ query }}

{% if tool_results %}
## Tool Results (cluster state data)
{% for result in tool_results %}
### {{ result.tool }}
```
{{ result.output }}
```
{% endfor %}
{% endif %}

Diagnose the issue and provide a complete remediation plan."""

YAML_GENERATION_TEMPLATE = """You are a Kubernetes YAML generation expert. Generate valid, production-ready
Kubernetes manifests based on the following request.

Requirements:
- Use best practices (resource limits, health probes, security contexts)
- Add meaningful comments explaining non-obvious settings
- Output ONLY valid YAML, no prose before or after

Request: {{ request }}

{% if context %}
Context: {{ context }}
{% endif %}"""

INTENT_CLASSIFICATION_TEMPLATE = """Classify the following Kubernetes query into exactly one category.

Categories:
- diagnose: debugging issues, errors, incidents
- explain: explaining concepts, resources, behaviors
- generate: creating YAML manifests, configs, scripts
- analyze: cost analysis, security audit, performance review
- execute: running commands, applying changes (dangerous)
- general: general Q&A not fitting above

Query: {{ query }}

Respond with ONLY the category name, nothing else."""


class PromptTemplate:
    """Render a Jinja2 prompt template into a list of Messages."""

    def __init__(self, template_str: str) -> None:
        self._tmpl = _env.from_string(template_str)

    def render(self, **kwargs: Any) -> str:
        return self._tmpl.render(**kwargs)


class KotgPrompts:
    """Factory for common KOTG.AI prompts."""

    diagnose = PromptTemplate(DIAGNOSE_TEMPLATE)
    yaml_generation = PromptTemplate(YAML_GENERATION_TEMPLATE)
    intent_classification = PromptTemplate(INTENT_CLASSIFICATION_TEMPLATE)

    @staticmethod
    def diagnose_messages(
        query: str,
        cluster_context: str = "",
        tool_results: list[dict[str, str]] | None = None,
    ) -> list[Message]:
        system = PromptTemplate(SYSTEM_KUBERNETES_EXPERT).render(
            cluster_context=cluster_context
        )
        user = KotgPrompts.diagnose.render(
            system_prompt="",
            query=query,
            tool_results=tool_results or [],
        )
        return [
            Message(role="system", content=system),
            Message(role="user", content=user),
        ]

    @staticmethod
    def yaml_messages(request: str, context: str = "") -> list[Message]:
        content = KotgPrompts.yaml_generation.render(request=request, context=context)
        return [Message(role="user", content=content)]

    @staticmethod
    def intent_messages(query: str) -> list[Message]:
        content = KotgPrompts.intent_classification.render(query=query)
        return [Message(role="user", content=content)]
