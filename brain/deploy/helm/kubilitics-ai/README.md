# kubilitics-ai Helm Chart

Deploys the kubilitics-ai runtime in-cluster: the AI brain that
implements [kotg-schema](https://github.com/vellankikoti/kotg-schema)'s
`Chat` + `AIControl` services and is consumed by
[kubilitics-backend](https://github.com/vellankikoti/kubilitics).

## Quick start

```sh
# 1. Install kubilitics-ai (LLM-only, with a local Ollama)
helm install kubilitics-ai ./deploy/helm/kubilitics-ai \
  --namespace kubilitics --create-namespace \
  --set llm.provider=ollama \
  --set llm.ollama.baseUrl=http://ollama.default.svc.cluster.local:11434 \
  --set llm.ollama.model=qwen2.5-coder:7b

# 2. Install kubilitics-backend, pointed at us
helm install kubilitics ../kubilitics/deploy/helm/kubilitics \
  --namespace kubilitics \
  --set ai.enabled=true
  # (ai.endpoint defaults to kubilitics-ai.kubilitics.svc.cluster.local:50051)
```

## Wire contract

This chart serves:

- **gRPC `:50051`** — `kotgv1.Chat` (CreateSession, Send bidi, CancelTurn, ListSessions) + `kotgv1.AIControl` (Capabilities, Health)
- **HTTP `:8081`** — `/status` health/readiness, plus REST surfaces (`/api/v1/*`)

Runtime configuration is rendered into a ConfigMap and mounted at
`/etc/kubilitics/config.yaml`. API keys, when provided inline, are
rendered into a Secret and projected as the provider-specific env
var (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `CUSTOM_API_KEY`).

## OpenAI / Anthropic

```sh
helm install kubilitics-ai ./deploy/helm/kubilitics-ai \
  --set llm.provider=openai \
  --set-string llm.openai.apiKey=sk-... \
  --set llm.openai.model=gpt-4o-mini

# or reference an existing Secret you manage out-of-band:
helm install kubilitics-ai ./deploy/helm/kubilitics-ai \
  --set llm.provider=anthropic \
  --set llm.anthropic.apiKeySecretRef.name=anthropic-creds \
  --set llm.anthropic.apiKeySecretRef.key=api-key
```

## Optional engines

### kagent (CNCF agent runtime)

kagent is **not** bundled. Install it separately
([instructions](https://kagent.dev/docs/kagent/introduction/installation)),
then enable our adapter:

```sh
helm upgrade kubilitics-ai ./deploy/helm/kubilitics-ai \
  --reuse-values \
  --set engines.kagent.enabled=true \
  --set engines.kagent.endpoint=http://kagent-controller.kagent.svc.cluster.local:8083
```

v1 ships the Engine skeleton; the real wire-level integration is v1.5.

### Python multi-agent (LangGraph)

Same shape. Disabled by default. Real Python sidecar deployment is v1.5.

## Safety wrapper

```sh
--set 'safety.allowedActions={scale,rollout_restart,delete_pod}'
```

Empty (default) blocks all action proposals — most conservative. Wildcard
`["*"]` allows all (development convenience).

## See also

- Backend chart: https://github.com/vellankikoti/kubilitics/tree/main/deploy/helm/kubilitics
- Wire contract: https://github.com/vellankikoti/kotg-schema
- Architecture spec: https://github.com/vellankikoti/kubilitics/blob/main/docs/superpowers/specs/2026-04-19-backend-kubilitics-ai-integration-design.md
