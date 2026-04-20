#!/usr/bin/env python3
"""Generate 3 natural-language prompts per MCP tool from tools-catalog.json.

The goal is coverage testing: each prompt should plausibly trigger ONE specific
tool when given to an LLM with the full tool list available. We keep wording
varied (direct/indirect, formal/casual, with/without args) and embed the tool's
core action verbs and resource nouns from its description.

Templates are picked by tool-name prefix, then enriched with description-derived
nouns (pod, deployment, namespace, etc.). For tools too generic to template
naturally we fall back to "use {tool_name}: {desc-derived sentence}" forms.
"""

import json
import re
import sys
from pathlib import Path

CATALOG = Path("/tmp/tools-catalog.json")
OUT = Path("/tmp/comprehensive-prompts.yaml")

# Sample namespaces / names used to vary phrasing.
NAMESPACES = ["default", "production", "kube-system", "data", "staging"]
POD_NAMES = ["api-7d8", "nginx-x12", "worker-3f", "db-primary", "frontend-abc"]
DEPLOY_NAMES = ["api", "frontend", "checkout", "billing", "auth"]


def humanize(name: str) -> str:
    return name.replace("_", " ")


def first_sentence(desc: str) -> str:
    # Strip trailing period, take first sentence.
    s = re.split(r"(?<=[.!?])\s", desc.strip())[0]
    return s.rstrip(".")


def templates_for(tool: dict) -> list[str]:
    name = tool["name"]
    desc = tool["description"]
    cat = tool["category"]
    nice = humanize(name)

    # Direct prefix-based templates
    prefixes = {
        "observe_": [
            f"Show me {nice.replace('observe ', '')}.",
            f"Give me a detailed view of {nice.replace('observe ', '')} in the cluster.",
            f"I want to inspect {nice.replace('observe ', '')} right now.",
        ],
        "analyze_": [
            f"Run an analysis on {nice.replace('analyze ', '')}.",
            f"Diagnose what's going on with {nice.replace('analyze ', '')}.",
            f"Please {nice} for me and report findings.",
        ],
        "diagnose_": [
            f"Diagnose {nice.replace('diagnose ', '')} in the cluster.",
            f"What's wrong with {nice.replace('diagnose ', '')}?",
            f"Investigate problems with {nice.replace('diagnose ', '')}.",
        ],
        "detect_": [
            f"Detect {nice.replace('detect ', '')}.",
            f"Find any {nice.replace('detect ', '')} happening right now.",
            f"Scan for {nice.replace('detect ', '')} across the cluster.",
        ],
        "predict_": [
            f"Predict {nice.replace('predict ', '')}.",
            f"Forecast {nice.replace('predict ', '')} for the next hour.",
            f"Give me a prediction of {nice.replace('predict ', '')}.",
        ],
        "recommend_": [
            f"Recommend {nice.replace('recommend ', '')}.",
            f"What do you suggest for {nice.replace('recommend ', '')}?",
            f"I need a recommendation about {nice.replace('recommend ', '')}.",
        ],
        "scale_": [
            f"Scale {nice.replace('scale ', '')} for me.",
            f"Adjust replicas: {nice}.",
            f"Please {nice} in the production namespace.",
        ],
        "restart_": [
            f"Restart {nice.replace('restart ', '')}.",
            f"Bounce {nice.replace('restart ', '')} now.",
            f"I need to {nice} in the default namespace.",
        ],
        "delete_": [
            f"Delete {nice.replace('delete ', '')}.",
            f"Remove {nice.replace('delete ', '')} from the cluster.",
            f"Please {nice} — yes I'm sure.",
        ],
        "rollback_": [
            f"Rollback {nice.replace('rollback ', '')}.",
            f"Revert {nice.replace('rollback ', '')} to the previous version.",
            f"Please {nice} immediately.",
        ],
        "apply_": [
            f"Apply {nice.replace('apply ', '')}.",
            f"Push {nice.replace('apply ', '')} to the cluster.",
            f"I want to {nice} now.",
        ],
        "create_": [
            f"Create {nice.replace('create ', '')}.",
            f"Provision a new {nice.replace('create ', '')} in production.",
            f"Spin up {nice.replace('create ', '')} please.",
        ],
        "update_": [
            f"Update {nice.replace('update ', '')}.",
            f"Modify {nice.replace('update ', '')} in the cluster.",
            f"Please {nice} with the new values.",
        ],
        "patch_": [
            f"Patch {nice.replace('patch ', '')}.",
            f"Apply a patch to {nice.replace('patch ', '')}.",
            f"Please {nice} with the JSON merge patch.",
        ],
        "drain_": [
            f"Drain {nice.replace('drain ', '')}.",
            f"Evict pods and {nice}.",
            f"Please {nice} so we can perform maintenance.",
        ],
        "cordon_": [
            f"Cordon {nice.replace('cordon ', '')}.",
            f"Mark {nice.replace('cordon ', '')} unschedulable.",
            f"Please {nice} immediately.",
        ],
        "uncordon_": [
            f"Uncordon {nice.replace('uncordon ', '')}.",
            f"Make {nice.replace('uncordon ', '')} schedulable again.",
            f"Please {nice} so workloads can land there.",
        ],
        "list_": [
            f"List {nice.replace('list ', '')}.",
            f"Show me all {nice.replace('list ', '')}.",
            f"What {nice.replace('list ', '')} do we have?",
        ],
        "get_": [
            f"Get {nice.replace('get ', '')}.",
            f"Show me the {nice.replace('get ', '')}.",
            f"Fetch {nice.replace('get ', '')} from the cluster.",
        ],
        "describe_": [
            f"Describe {nice.replace('describe ', '')}.",
            f"Give me a description of {nice.replace('describe ', '')}.",
            f"Explain {nice.replace('describe ', '')} in detail.",
        ],
        "check_": [
            f"Check {nice.replace('check ', '')}.",
            f"Verify {nice.replace('check ', '')}.",
            f"I want you to {nice} and tell me what you find.",
        ],
        "scan_": [
            f"Scan {nice.replace('scan ', '')}.",
            f"Run a scan on {nice.replace('scan ', '')}.",
            f"Please {nice} for issues.",
        ],
        "audit_": [
            f"Audit {nice.replace('audit ', '')}.",
            f"Run an audit on {nice.replace('audit ', '')}.",
            f"Please {nice} for compliance.",
        ],
        "validate_": [
            f"Validate {nice.replace('validate ', '')}.",
            f"Check the validity of {nice.replace('validate ', '')}.",
            f"Please {nice} before applying.",
        ],
        "trace_": [
            f"Trace {nice.replace('trace ', '')}.",
            f"Run a trace on {nice.replace('trace ', '')}.",
            f"Please {nice} so I can see the path.",
        ],
        "find_": [
            f"Find {nice.replace('find ', '')}.",
            f"Locate {nice.replace('find ', '')} in the cluster.",
            f"Where can I find {nice.replace('find ', '')}?",
        ],
        "monitor_": [
            f"Monitor {nice.replace('monitor ', '')}.",
            f"Watch {nice.replace('monitor ', '')} continuously.",
            f"Please {nice} and alert me on changes.",
        ],
        "compare_": [
            f"Compare {nice.replace('compare ', '')}.",
            f"Show me a diff of {nice.replace('compare ', '')}.",
            f"Please {nice} side by side.",
        ],
        "estimate_": [
            f"Estimate {nice.replace('estimate ', '')}.",
            f"Give me an estimate of {nice.replace('estimate ', '')}.",
            f"Please {nice} for budgeting.",
        ],
        "explain_": [
            f"Explain {nice.replace('explain ', '')}.",
            f"Help me understand {nice.replace('explain ', '')}.",
            f"Please {nice} in plain English.",
        ],
        "suggest_": [
            f"Suggest {nice.replace('suggest ', '')}.",
            f"What do you suggest for {nice.replace('suggest ', '')}?",
            f"Please {nice} based on current state.",
        ],
        "remediate_": [
            f"Remediate {nice.replace('remediate ', '')}.",
            f"Fix {nice.replace('remediate ', '')}.",
            f"Please {nice} now.",
        ],
        "approve_": [
            f"Approve {nice.replace('approve ', '')}.",
            f"Grant approval for {nice.replace('approve ', '')}.",
            f"Please {nice} so it can proceed.",
        ],
        "execute_": [
            f"Execute {nice.replace('execute ', '')}.",
            f"Run {nice.replace('execute ', '')}.",
            f"Please {nice} immediately.",
        ],
        "cost_": [
            f"Show me {nice}.",
            f"Give me a {nice} report.",
            f"What is the {nice} right now?",
        ],
    }

    # Special-case: 'observe_' tools need name fragments embedded
    for prefix, t in prefixes.items():
        if name.startswith(prefix):
            return t

    # Generic fallback: use description + nice name.
    fs = first_sentence(desc)
    return [
        f"{fs}.",
        f"Please run the {nice} workflow.",
        f"I want to use {nice} on the cluster.",
    ]


def main() -> int:
    if not CATALOG.exists():
        print(f"missing {CATALOG}", file=sys.stderr)
        return 1
    catalog = json.loads(CATALOG.read_text())

    out_lines = ["version: 1", "prompts:"]
    total = 0
    for t in catalog:
        prompts = templates_for(t)
        for i, text in enumerate(prompts, start=1):
            # Light variety: every 3rd prompt mentions a namespace if obviously pod/deploy related
            if i == 2 and any(x in t["description"].lower() for x in ("pod", "deployment", "service", "namespace")):
                ns = NAMESPACES[(total) % len(NAMESPACES)]
                if "namespace" not in text.lower():
                    text = text.rstrip(".") + f" in the {ns} namespace."
            text = text.replace("  ", " ").strip()
            pid = f"{t['name']}__{i}"
            out_lines.append(f"  - id: {pid}")
            out_lines.append(f"    expected_tool: {t['name']}")
            out_lines.append(f"    category: {t['category']}")
            # YAML-quote text safely.
            esc = text.replace('"', '\\"')
            out_lines.append(f'    text: "{esc}"')
            total += 1

    OUT.write_text("\n".join(out_lines) + "\n")
    print(f"generated {total} prompts across {len(catalog)} tools -> {OUT}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
