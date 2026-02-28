"""Tests for prompt template rendering."""

from kotg.core.prompts import KotgPrompts
from kotg.core.llm import Message


def test_diagnose_messages_structure():
    messages = KotgPrompts.diagnose_messages(
        query="my pod is in CrashLoopBackOff",
        cluster_context="namespace: production",
    )
    assert len(messages) == 2
    assert messages[0].role == "system"
    assert messages[1].role == "user"
    assert "CrashLoopBackOff" in messages[1].content


def test_diagnose_messages_with_tool_results():
    tool_results = [{"tool": "kubectl_get", "output": "pod-1  Running  1/1"}]
    messages = KotgPrompts.diagnose_messages(
        query="check pod status",
        tool_results=tool_results,
    )
    assert "kubectl_get" in messages[1].content
    assert "pod-1" in messages[1].content


def test_yaml_messages_structure():
    messages = KotgPrompts.yaml_messages(request="nginx deployment")
    assert len(messages) == 1
    assert messages[0].role == "user"
    assert "nginx deployment" in messages[0].content


def test_intent_messages_structure():
    messages = KotgPrompts.intent_messages(query="diagnose CrashLoopBackOff")
    assert len(messages) == 1
    assert "diagnose CrashLoopBackOff" in messages[0].content


def test_system_prompt_contains_kubernetes_domains():
    messages = KotgPrompts.diagnose_messages(query="test")
    system = messages[0].content
    for domain in ["RBAC", "etcd", "CNI", "Prometheus"]:
        assert domain in system


def test_prompt_renders_cluster_context():
    messages = KotgPrompts.diagnose_messages(
        query="q",
        cluster_context="context: my-prod-cluster",
    )
    assert "my-prod-cluster" in messages[0].content
