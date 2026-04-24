"""KOTG.AI CLI — entry point for all user-facing commands."""

from __future__ import annotations

import asyncio
import sys
from typing import Optional

import structlog
import typer
from rich.console import Console
from rich.markdown import Markdown
from rich.panel import Panel
from rich.progress import Progress, SpinnerColumn, TextColumn
from rich.syntax import Syntax

from kotg import __version__

app = typer.Typer(
    name="kotg",
    help="KOTG.AI — Local-first, multi-agent Kubernetes intelligence platform.",
    rich_markup_mode="rich",
    no_args_is_help=True,
)

console = Console()
err_console = Console(stderr=True)

logger = structlog.get_logger(__name__)

# ---------------------------------------------------------------------------
# Shared options
# ---------------------------------------------------------------------------

_DEBUG_OPTION = typer.Option(False, "--debug", "-d", help="Enable debug logging")
_NAMESPACE_OPTION = typer.Option("", "--namespace", "-n", help="Kubernetes namespace")
_CONTEXT_OPTION = typer.Option("", "--context", help="Kubeconfig context")
_MODEL_TIER_OPTION = typer.Option("auto", "--tier", "-t", help="Model tier: nano/small/medium/large/expert/auto")


# ---------------------------------------------------------------------------
# Banner
# ---------------------------------------------------------------------------

BANNER = """
[bold blue]╔═══════════════════════════════════════════╗[/bold blue]
[bold blue]║   [bold white]KOTG.AI[/bold white] — Kubernetes On The Go        ║[/bold blue]
[bold blue]║   Local-first multi-agent K8s intelligence ║[/bold blue]
[bold blue]╚═══════════════════════════════════════════╝[/bold blue]
"""


# ---------------------------------------------------------------------------
# Diagnosis command
# ---------------------------------------------------------------------------

@app.command("diagnose")
def diagnose(
    query: str = typer.Argument(..., help="Describe the issue or paste error messages"),
    namespace: str = _NAMESPACE_OPTION,
    context: str = _CONTEXT_OPTION,
    debug: bool = _DEBUG_OPTION,
    stream: bool = typer.Option(False, "--stream", "-s", help="Stream response tokens"),
    no_tools: bool = typer.Option(False, "--no-tools", help="Disable kubectl MCP tools"),
) -> None:
    """
    [bold]Diagnose a Kubernetes issue.[/bold]

    Examples:
      kotg diagnose "my pod is CrashLoopBackOff"
      kotg diagnose "node is NotReady" -n production
      kotg diagnose "explain OOMKilled"
    """
    _setup_logging(debug)
    console.print(BANNER)

    cluster_context = _build_cluster_context(namespace, context)

    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        console=console,
        transient=True,
    ) as progress:
        task_id = progress.add_task("Initializing agent...", total=None)

        try:
            from kotg.agents.kubernetes_agent import KubernetesAgent
            from kotg.mcp.kubectl import build_kubectl_registry

            registry = build_kubectl_registry() if not no_tools else _empty_registry()

            agent = KubernetesAgent(registry=registry)
            progress.update(task_id, description=f"[cyan]Diagnosing:[/cyan] {query[:60]}...")

            state = asyncio.run(agent.run(query, cluster_context=cluster_context))

        except Exception as exc:
            err_console.print(f"[red]Error:[/red] {exc}")
            if debug:
                import traceback
                err_console.print(traceback.format_exc())
            raise typer.Exit(1) from exc

    # Display results
    _display_diagnosis(state, debug=debug)


def _display_diagnosis(state: "AgentState", debug: bool = False) -> None:  # noqa: F821
    """Render the diagnosis result to the terminal."""
    from kotg.agents.kubernetes_agent import AgentState

    # Tool results panel
    if state.tool_results:
        console.print()
        console.print(Panel(
            f"[dim]Called {len(state.tool_results)} kubectl tool(s)[/dim]",
            title="[bold]Cluster Data Collected[/bold]",
            border_style="blue",
        ))

    # Main response
    console.print()
    if state.final_response:
        md = Markdown(state.final_response)
        console.print(Panel(
            md,
            title="[bold green]KOTG.AI Diagnosis[/bold green]",
            border_style="green",
            padding=(1, 2),
        ))
    elif state.error:
        console.print(Panel(
            f"[red]{state.error}[/red]",
            title="[bold red]Error[/bold red]",
            border_style="red",
        ))

    # Debug: reasoning steps
    if debug and state.steps:
        console.print()
        console.print("[dim]Reasoning steps:[/dim]")
        for i, step in enumerate(state.steps, 1):
            console.print(f"  [dim]{i}.[/dim] {step}")


# ---------------------------------------------------------------------------
# Ask command (conversational)
# ---------------------------------------------------------------------------

@app.command("ask")
def ask(
    query: str = typer.Argument(..., help="Ask any Kubernetes question"),
    debug: bool = _DEBUG_OPTION,
) -> None:
    """
    [bold]Ask a Kubernetes question.[/bold]

    Examples:
      kotg ask "what is a DaemonSet?"
      kotg ask "how does HPA work?"
    """
    _setup_logging(debug)

    try:
        from kotg.agents.kubernetes_agent import KubernetesAgent
        from kotg.mcp.kubectl import build_kubectl_registry

        agent = KubernetesAgent(registry=build_kubectl_registry())

        with console.status("[cyan]Thinking...[/cyan]"):
            state = asyncio.run(agent.run(query))

        if state.final_response:
            console.print(Markdown(state.final_response))
        else:
            console.print("[yellow]No response generated.[/yellow]")

    except Exception as exc:
        err_console.print(f"[red]Error:[/red] {exc}")
        raise typer.Exit(1) from exc


# ---------------------------------------------------------------------------
# Generate command
# ---------------------------------------------------------------------------

@app.command("generate")
def generate(
    request: str = typer.Argument(..., help="Describe what Kubernetes YAML to generate"),
    output: Optional[str] = typer.Option(None, "--output", "-o", help="Write to file"),
    debug: bool = _DEBUG_OPTION,
) -> None:
    """
    [bold]Generate Kubernetes YAML manifests.[/bold]

    Examples:
      kotg generate "nginx deployment with 3 replicas and HPA"
      kotg generate "PodDisruptionBudget for my-app" -o pdb.yaml
    """
    _setup_logging(debug)

    try:
        from kotg.agents.kubernetes_agent import Intent, KubernetesAgent
        from kotg.mcp.base import MCPToolRegistry

        agent = KubernetesAgent(registry=MCPToolRegistry())

        with console.status("[cyan]Generating YAML...[/cyan]"):
            state = asyncio.run(agent.run(f"generate {request}"))

        yaml_content = state.final_response

        if output:
            with open(output, "w") as f:
                f.write(yaml_content)
            console.print(f"[green]✓[/green] Written to {output}")
        else:
            syntax = Syntax(yaml_content, "yaml", theme="monokai", line_numbers=True)
            console.print(syntax)

    except Exception as exc:
        err_console.print(f"[red]Error:[/red] {exc}")
        raise typer.Exit(1) from exc


# ---------------------------------------------------------------------------
# Models command
# ---------------------------------------------------------------------------

models_app = typer.Typer(help="Manage local LLM models via Ollama.")
app.add_typer(models_app, name="models")


@models_app.command("list")
def models_list() -> None:
    """List configured KOTG.AI models and their tiers."""
    from kotg.core.config import get_settings
    cfg = get_settings().models

    console.print("\n[bold]KOTG.AI Model Configuration[/bold]\n")
    rows = [
        ("nano",   cfg.nano_model,   "Intent classification, slot filling",     "1GB RAM"),
        ("small",  cfg.small_model,  "Tool selection, YAML generation",           "3GB RAM"),
        ("medium", cfg.medium_model, "Multi-step reasoning, incident diagnosis", "8GB RAM"),
        ("large",  cfg.large_model,  "Complex architecture analysis",            "16GB RAM"),
        ("expert", cfg.expert_model, "Full cluster reasoning",                   "32GB RAM"),
    ]

    from rich.table import Table
    table = Table(show_header=True, header_style="bold cyan")
    table.add_column("Tier", style="cyan", width=8)
    table.add_column("Model", style="white")
    table.add_column("Use Case", style="dim")
    table.add_column("Min RAM", style="green")

    for tier, model, use_case, ram in rows:
        table.add_row(tier, model, use_case, ram)

    console.print(table)
    console.print(f"\n[dim]Embedding model: {cfg.embedding_model}[/dim]")


@models_app.command("install")
def models_install(
    tier: str = typer.Argument("medium", help="Tier to install: nano/small/medium/large/expert/all"),
) -> None:
    """
    Download and install KOTG.AI models via Ollama.

    Example: kotg models install medium
    """
    from kotg.core.config import ModelTier, get_settings
    cfg = get_settings().models

    tier_map = {
        "nano": [(ModelTier.NANO, cfg.nano_model)],
        "small": [(ModelTier.SMALL, cfg.small_model)],
        "medium": [(ModelTier.MEDIUM, cfg.medium_model)],
        "large": [(ModelTier.LARGE, cfg.large_model)],
        "expert": [(ModelTier.EXPERT, cfg.expert_model)],
        "all": [
            (ModelTier.NANO, cfg.nano_model),
            (ModelTier.SMALL, cfg.small_model),
            (ModelTier.MEDIUM, cfg.medium_model),
        ],
    }

    if tier not in tier_map:
        err_console.print(f"[red]Unknown tier: {tier}. Choose from: {list(tier_map)}[/red]")
        raise typer.Exit(1)

    models_to_install = tier_map[tier]
    console.print(f"\n[bold]Installing {len(models_to_install)} model(s) via Ollama...[/bold]\n")

    import subprocess
    for model_tier, model_name in models_to_install:
        console.print(f"[cyan]→[/cyan] Pulling [bold]{model_name}[/bold]...")
        result = subprocess.run(
            ["ollama", "pull", model_name],
            capture_output=False,
        )
        if result.returncode == 0:
            console.print(f"[green]✓[/green] {model_name} installed")
        else:
            err_console.print(f"[red]✗[/red] Failed to install {model_name}")


# ---------------------------------------------------------------------------
# Version command
# ---------------------------------------------------------------------------

@app.command("version")
def version() -> None:
    """Show KOTG.AI version information."""
    console.print(f"kotg version [bold]{__version__}[/bold]")


# ---------------------------------------------------------------------------
# Utilities
# ---------------------------------------------------------------------------

def _setup_logging(debug: bool) -> None:
    import logging
    import structlog

    log_level = logging.DEBUG if debug else logging.WARNING
    logging.basicConfig(level=log_level)

    structlog.configure(
        wrapper_class=structlog.make_filtering_bound_logger(log_level),
    )


def _build_cluster_context(namespace: str, context: str) -> str:
    parts = []
    if context:
        parts.append(f"kubeconfig context: {context}")
    if namespace:
        parts.append(f"namespace: {namespace}")
    return "; ".join(parts)


def _empty_registry() -> "MCPToolRegistry":  # noqa: F821
    from kotg.mcp.base import MCPToolRegistry
    return MCPToolRegistry()


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    app()


if __name__ == "__main__":
    main()
