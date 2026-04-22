#!/usr/bin/env python3
"""generate-tool-catalog.py — regenerates
kubilitics-frontend/src/data/tool-catalog.json from the kubilitics-ai
taxonomy + plain-english descriptions. Run this whenever tools are
added/renamed/retired in the brain.

Usage:
  BRAIN_SRC=/path/to/kubilitics-ai python3 scripts/generate-tool-catalog.py

Env vars:
  BRAIN_SRC   — path to a kubilitics-ai working tree (default:
                /tmp/kotg-ai-vk/kubilitics-ai)
"""
import json
import os
import re
import sys

BRAIN = os.environ.get("BRAIN_SRC", "/tmp/kotg-ai-vk/kubilitics-ai")
FRONTEND_OUT = "kubilitics-frontend/src/data/tool-catalog.json"

taxonomy_path = os.path.join(BRAIN, "internal/mcp/tools/taxonomy.go")
desc_path = os.path.join(BRAIN, "docs/reports/plain-english.json")

if not os.path.isfile(taxonomy_path):
    sys.exit(f"ERROR: {taxonomy_path} not found; set BRAIN_SRC")
if not os.path.isfile(desc_path):
    sys.exit(f"ERROR: {desc_path} not found; set BRAIN_SRC")

with open(desc_path) as f:
    descriptions = json.load(f)
with open(taxonomy_path) as f:
    src = f.read()

entries = []
for m in re.finditer(r'\{\s*Name:\s*"([^"]+)",\s*Category:\s*Category(\w+)', src):
    entries.append({"name": m.group(1), "category": m.group(2)})

PREFIX_TO_GROUP = [
    ("observe_", "Observation"),
    ("inspect_", "Observation"),
    ("analyze_", "Analysis"),
    ("diagnose_", "Diagnostics"),
    ("check_", "Compliance"),
    ("plan_", "Planning"),
    ("narrate_", "Narrative"),
    ("recommend_", "Recommendation"),
    ("troubleshoot_", "Troubleshooting"),
    ("security_", "Security"),
    ("cost_", "Cost"),
    ("automation_", "Automation"),
    ("action_", "Action"),
    ("apply_", "Action"),
    ("delete_", "Action"),
    ("cordon_", "Action"),
    ("drain_", "Action"),
    ("restart_", "Action"),
    ("rollback_", "Action"),
    ("scale_", "Action"),
    ("trigger_", "Action"),
    ("update_", "Action"),
    ("export_", "Utility"),
    ("resolve_", "Utility"),
    ("assess_", "Security"),
    ("detect_", "Diagnostics"),
    ("get_", "Observation"),
    ("list_", "Observation"),
]

def ux_group(name: str) -> str:
    if name == "who_can_do":
        return "RBAC"
    for pfx, grp in PREFIX_TO_GROUP:
        if name.startswith(pfx):
            return grp
    return "Misc"

catalog = []
seen = set()
for e in entries:
    if e["name"] in seen:
        continue
    seen.add(e["name"])
    catalog.append({
        "name": e["name"],
        "category": e["category"],
        "group": ux_group(e["name"]),
        "description": descriptions.get(e["name"], ""),
    })

# Description-only entries (chat aliases etc.)
for name, desc in descriptions.items():
    if name in seen:
        continue
    seen.add(name)
    catalog.append({
        "name": name,
        "category": "Chat",
        "group": ux_group(name),
        "description": desc,
    })

catalog.sort(key=lambda x: (x["group"], x["name"]))

os.makedirs(os.path.dirname(FRONTEND_OUT), exist_ok=True)
with open(FRONTEND_OUT, "w") as f:
    json.dump({
        "generated_at": "2026-04-22",
        "version": "1.1.0",
        "tools": catalog,
    }, f, indent=2)
    f.write("\n")

groups = {}
for e in catalog:
    groups[e["group"]] = groups.get(e["group"], 0) + 1
print(f"wrote {len(catalog)} tools to {FRONTEND_OUT}")
print("by group:", sorted(groups.items()))
