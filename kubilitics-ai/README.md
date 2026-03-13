# kubilitics-ai

AI-powered Kubernetes cluster investigation and optimization engine.

## Overview

kubilitics-ai is an intelligent system that autonomously investigates, diagnoses, and recommends actions for your Kubernetes cluster. It leverages large language models (LLMs) via the Model Context Protocol (MCP) to provide explainable, trustworthy automation.

**Key Features:**
- Real-time cluster state monitoring via streaming from kubilitics-backend
- AI-driven investigation of pod crashes, performance issues, and anomalies
- Chain-of-thought reasoning for transparent decision-making
- Safety-gated execution with autonomy levels and rollback capabilities
- Multi-LLM support (OpenAI, Anthropic, Ollama, custom endpoints)
- Immutable audit logging for compliance
- Token budget tracking across multiple providers

## Architecture

```
kubilitics-ai (port 8081)
├── MCP Server (LLM interface)
│   ├── Observation Tools (read-only cluster access)
│   ├── Analysis Tools (computed insights)
│   ├── Recommendation Tools (action proposals)
│   └── Execution Tools (mutations, gated by Safety Engine)
├── Reasoning Engine (investigation orchestrator)
│   ├── World Model (cluster state)
│   ├── Context Builder (investigation context)
│   └── Prompt Manager (chain-of-thought templates)
├── Safety Engine (mutation gatekeeper)
│   ├── Policy Engine (immutable rules + configurable policies)
│   ├── Autonomy Controller (5 autonomy levels)
│   ├── Rollback Manager (automatic degradation detection)
│   └── Blast Radius Calculator (impact assessment)
├── Analytics Engine
│   ├── Time-Series Storage (metrics with auto-downsampling)
│   ├── Anomaly Detector (classical statistics)
│   ├── Forecasting (resource usage predictions)
│   └── Scoring (health/efficiency ratings)
├── Memory Subsystem
│   ├── World Model (in-memory cluster state)
│   ├── Temporal Store (time-travel queries)
│   └── Vector Store (semantic search, optional)
├── REST API (frontend communication, /api/v1/ai/*)
├── WebSocket Handler (streaming investigation updates)
└── Audit Logger (immutable append-only log)
        ↓
kubilitics-backend (port 819, separate service)
        ↓
Kubernetes API Server
```

## Quick Start

### Prerequisites
- Go 1.21+
- Docker (for containerized deployment)
- kubilitics-backend running on localhost:50051
- LLM API access (OpenAI, Anthropic) or local Ollama instance

### Build and Run

```bash
# Clone repository
git clone https://github.com/kubilitics/kubilitics-ai.git
cd kubilitics-ai

# Build
make build

# Run locally (connects to kubilitics-backend at localhost:50051)
make run

# Run with custom config
./bin/kubilitics-ai --config ./config.yaml
```

### Docker Deployment

```bash
# Build Docker image
make docker-build

# Run container
docker run -p 8081:8081 \
  -e KUBILITICS_BACKEND_ADDRESS=host.docker.internal:50051 \
  -e KUBILITICS_LLM_PROVIDER=anthropic \
  -e ANTHROPIC_API_KEY=your-key \
  kubilitics-ai:latest
```

## Configuration

Create `config.yaml` in `/etc/kubilitics/` or specify with `--config` flag.

### Example Configuration

```yaml
server:
  port: 8081
  tls_enabled: false

backend:
  address: localhost:50051
  timeout: 30

llm:
  provider: anthropic  # "openai", "anthropic", "ollama", "custom"
  anthropic:
    api_key: ${ANTHROPIC_API_KEY}
    model: claude-3-5-sonnet-20241022
    max_tokens: 2048

autonomy:
  default_level: 3  # 1=Observe, 2=Recommend, 3=Propose, 4=Act-with-Guard, 5=Full-Autonomous
  allow_level_override: true

safety:
  enable_immutable_rules: true
  enable_custom_policies: true
  require_approval_for_deletions: true

database:
  type: sqlite
  sqlite_path: /var/lib/kubilitics/kubilitics-ai.db

cache:
  enable_caching: true
  cache_ttl_seconds: 300
  max_cache_size_mb: 100

logging:
  level: info
  format: json

budget:
  global_monthly_budget: 100.0
  per_user_monthly_budget: 50.0
```

### Environment Variables

- `KUBILITICS_BACKEND_ADDRESS`: kubilitics-backend address (default: localhost:50051)
- `KUBILITICS_LLM_PROVIDER`: LLM provider (openai|anthropic|ollama|custom)
- `OPENAI_API_KEY`: OpenAI API key
- `ANTHROPIC_API_KEY`: Anthropic API key
- `OLLAMA_BASE_URL`: Ollama instance URL (default: http://localhost:11434)
- `KUBILITICS_AUTONOMY_LEVEL`: Default autonomy level (1-5)
- `KUBILITICS_PORT`: Server port (default: 8081)

## API Reference

### Investigations

```
GET    /api/v1/ai/investigations              # List investigations
POST   /api/v1/ai/investigations              # Create investigation
GET    /api/v1/ai/investigations/{id}         # Get investigation details
DELETE /api/v1/ai/investigations/{id}         # Cancel investigation
```

### Insights

```
GET    /api/v1/ai/insights                    # List insights
GET    /api/v1/ai/insights/{id}               # Get insight
DELETE /api/v1/ai/insights/{id}               # Delete insight
```

### Actions

```
GET    /api/v1/ai/actions                     # List actions
POST   /api/v1/ai/actions                     # Create action
GET    /api/v1/ai/actions/{id}                # Get action
PATCH  /api/v1/ai/actions/{id}/approve        # Approve action
PATCH  /api/v1/ai/actions/{id}/reject         # Reject action
```

### Analytics

```
GET    /api/v1/ai/metrics                     # Get metrics
GET    /api/v1/ai/anomalies                   # Get anomalies
GET    /api/v1/ai/forecasts                   # Get forecasts
GET    /api/v1/ai/health-scores               # Get health scores
```

### Chat

```
POST   /api/v1/ai/chat/message                # Send message
WS     /api/v1/ai/chat/stream                 # WebSocket for streaming
```

### Configuration

```
GET    /api/v1/ai/config                      # Get config
PATCH  /api/v1/ai/config                      # Update config
```

### Usage

```
GET    /api/v1/ai/usage/summary               # Usage summary
GET    /api/v1/ai/usage/details               # Usage details
```

### Health

```
GET    /health                                # Health check
GET    /healthz                               # Kubernetes probe
```

## Development

### Project Structure

```
kubilitics-ai/
├── cmd/server/              # Entry point
├── internal/
│   ├── api/                 # REST API and middleware
│   ├── mcp/                 # MCP server and tools
│   ├── reasoning/           # Investigation orchestration
│   ├── llm/                 # LLM adapters and providers
│   ├── analytics/           # Analytics engines
│   ├── safety/              # Safety gating
│   ├── memory/              # World Model and caches
│   ├── integration/         # Backend integration
│   ├── config/              # Configuration
│   ├── cache/               # Caching
│   ├── audit/               # Audit logging
│   └── models/              # Data types
├── pkg/
│   ├── types/               # Public API types
│   └── contracts/           # gRPC contracts
├── Dockerfile               # Docker build
├── Makefile                 # Build targets
└── config.example.yaml      # Configuration template
```

### Testing

```bash
# Run all tests
make test

# Run with coverage
go test -v -coverprofile=coverage.out ./...
go tool cover -html=coverage.out
```

### Linting

```bash
# Run linters
make lint

# Format code
gofmt -w .
```

### Code Generation

```bash
# Generate from .proto files
make proto
```

## Autonomy Levels

kubilitics-ai supports five autonomy levels controlling the degree of automation:

| Level | Name | Description | Use Case |
|-------|------|-------------|----------|
| 1 | Observe | Read-only monitoring | Learning, read-only access |
| 2 | Recommend | Suggestions only | Advisory mode |
| 3 | Propose | Propose actions, require approval | Default, controlled automation |
| 4 | Act-with-Guard | Auto-execute low-risk, approve high-risk | Mature systems |
| 5 | Full-Autonomous | Auto-execute all policy-approved actions | Highly trusted systems |

## Safety Features

### Immutable Safety Rules
- Cannot delete critical resources (kube-system, monitoring)
- Cannot scale critical services to zero
- Cannot drain all nodes
- Cannot break RBAC

### Configurable Safety Policies
- Scaling limits (min/max replicas)
- Resource request/limit constraints
- Namespace restrictions
- Rate limiting (max changes per time period)
- Cost limits

### Rollback Manager
- Monitors metrics after action execution
- Detects performance degradation
- Automatically reverts if metrics degrade
- Implements dead man's switch

### Blast Radius Calculator
- Predicts resources affected by change
- Identifies data loss risk
- Estimates downtime
- Supports decision-making

## Integration with LLM Providers

### OpenAI
- Models: GPT-4, GPT-4o, GPT-3.5-turbo
- Cost: ~$0.005-$0.03 per 1K tokens
- Token counting: Accurate via tiktoken

### Anthropic
- Models: Claude 3.5 Sonnet, Claude 3 Opus
- Cost: ~$0.003-$0.015 per 1K tokens
- Token counting: Accurate via API

### Ollama (Local)
- Models: llama3, mistral, neural-chat, etc.
- Cost: Zero (runs on user's machine)
- Token counting: Approximate

### Custom Endpoints
- Supports any OpenAI-compatible API
- Examples: vLLM, LocalAI, LM Studio
- Cost: Configurable

## Monitoring and Observability

kubilitics-ai provides comprehensive observability:

### Metrics (Prometheus-compatible)
- Investigation duration, success rate
- Tool call latency, error rate
- LLM API usage, token count, cost
- Cache hit/miss rates
- Safety policy evaluation counts

### Logging
- JSON-structured logs (default)
- Fields: timestamp, level, component, message, context
- Audit trail for all investigations and actions
- Accessible via REST API

### Health Checks
- `/health`: Readiness probe
- `/healthz`: Kubernetes-compatible liveness probe
- Backend connectivity status
- Database connectivity status
- LLM provider availability

## Troubleshooting

### kubilitics-ai fails to connect to kubilitics-backend
- Check backend is running on port 50051
- Verify `KUBILITICS_BACKEND_ADDRESS` env var or config
- Check firewall rules

### LLM API calls fail
- Verify API key is set correctly
- Check API rate limits
- Monitor token budget usage
- Try alternative provider

### Investigations timeout
- Increase `investigation_timeout` in config
- Check backend response latency
- Reduce context window size if needed

### High memory usage
- Reduce `max_cache_size_mb`
- Reduce `timeseries_retention_days`
- Limit World Model scope to specific namespaces

## Contributing

We welcome contributions! Please:
1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Run `make lint` and `make test`
5. Submit a pull request

## License

Copyright (c) 2024 Kubilitics. Licensed under the MIT License.

## Support

- Documentation: https://docs.kubilitics.com
- Issues: https://github.com/kubilitics/kubilitics-ai/issues
- Community: https://slack.kubilitics.com
