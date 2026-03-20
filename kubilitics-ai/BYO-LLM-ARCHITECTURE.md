# Kubilitics AI: Bring Your Own LLM (BYO-LLM) Architecture

**Version:** 1.0
**Date:** February 2026
**Philosophy:** ZERO Vendor Lock-in, TRUE Open Source

---

## Core Principle: User Choice, Not Vendor Choice

Kubilitics AI is built on a fundamental principle: **The user chooses their LLM provider, not us.**

We support **ALL major LLM providers** out of the box:
- ✅ **OpenAI** (GPT-4, GPT-4o, GPT-3.5-turbo) - Most popular
- ✅ **Anthropic** (Claude 3.5 Sonnet, Opus, Haiku) - Premium quality
- ✅ **Ollama** (Llama 3, Mistral, CodeLlama, etc.) - Local/Free
- ✅ **Custom** (vLLM, LocalAI, LM Studio, any OpenAI-compatible) - Self-hosted

---

## Why BYO-LLM?

### 1. **No Vendor Lock-in**
- User owns their API key
- User controls their costs
- User can switch providers anytime
- No dependency on our infrastructure

### 2. **Privacy & Compliance**
- Users can choose local models (Ollama) for sensitive data
- Data never goes through Kubilitics servers
- Direct API calls from user's kubilitics-ai instance
- GDPR/HIPAA compliance possible with self-hosted

### 3. **Cost Control**
- User pays their LLM provider directly
- No markup from Kubilitics
- Budget tracking shows real costs
- Can optimize model choice for cost

### 4. **Future-Proof**
- New LLM providers work via OpenAI-compatible APIs
- No code changes needed for new models
- User innovation, not our limitation

---

## Configuration Flow

### User Experience (Settings → AI Configuration)

```
1. User clicks "Configure AI Provider"
2. Selects provider: [OpenAI | Anthropic | Ollama | Custom]
3. Enters credentials:
   - OpenAI: API Key + Model (gpt-4, gpt-4o, etc.)
   - Anthropic: API Key + Model (claude-3-5-sonnet, etc.)
   - Ollama: Base URL (http://localhost:11434) + Model (llama3, etc.)
   - Custom: Base URL + API Key + Model
4. Clicks "Test Connection"
5. Kubilitics validates API key
6. Config saved (encrypted at rest)
7. AI features enabled
```

### Technical Storage

**Frontend Config (React State):**
```typescript
interface AIConfig {
  provider: 'openai' | 'anthropic' | 'ollama' | 'custom'
  apiKey: string // Encrypted in localStorage
  baseURL?: string // For Ollama/Custom
  model: string
}
```

**Backend Config (config.yaml):**
```yaml
llm:
  provider: openai
  api_key: ${KUBILITICS_LLM_API_KEY} # From env or encrypted file
  model: gpt-4o
  # Optional for custom/ollama:
  base_url: http://localhost:11434
```

**Environment Variables (12-factor app):**
```bash
KUBILITICS_LLM_PROVIDER=openai
KUBILITICS_LLM_API_KEY=sk-...
KUBILITICS_LLM_MODEL=gpt-4o
KUBILITICS_LLM_BASE_URL= # Optional for custom/ollama
```

---

## Provider Support Matrix

| Provider | Streaming | Tool Calling | Local | Cost |
|----------|-----------|--------------|-------|------|
| **OpenAI** | ✅ | ✅ (function_call) | ❌ | $$$ |
| **Anthropic** | ✅ | ✅ (tool_use) | ❌ | $$$ |
| **Ollama** | ✅ | ✅ (via OpenAI compat) | ✅ | FREE |
| **Custom** | ✅ | ✅ (provider-dependent) | ✅ | Varies |

---

## Graceful Degradation (No LLM Configured)

When user has NOT configured an LLM:

### ✅ **Works Without LLM:**
- ✅ Cluster monitoring and visualization
- ✅ Resource listing and detail views
- ✅ Logs and events viewing
- ✅ Topology graph rendering
- ✅ MCP tool execution (observation tools)
- ✅ Analytics Engine (statistical anomaly detection)
- ✅ Metrics and health checks
- ✅ Manual troubleshooting

### ⚠️ **Disabled Without LLM:**
- ⚠️ AI-powered reasoning (root cause analysis)
- ⚠️ Automated recommendations
- ⚠️ Investigation sessions
- ⚠️ Natural language queries
- ⚠️ Autonomous actions (Level 4 autonomy)

### 🎯 **User Messaging:**
```
"AI Features Disabled"
Kubilitics AI requires an LLM provider to enable:
- Root cause analysis
- Automated recommendations
- Investigation sessions

👉 Configure your AI provider in Settings → AI Configuration
Supported: OpenAI, Anthropic, Ollama (local/free), Custom
```

---

## Adapter Architecture

### Unified Interface
```go
type LLMAdapter interface {
    Complete(ctx, messages, tools) (string, []toolCalls, error)
    CompleteStream(ctx, messages, tools) (textChan, toolChan, error)
    CountTokens(ctx, messages, tools) (int, error)
    GetCapabilities(ctx) (Capabilities, error)
    ValidateToolCall(ctx, toolName, args) error
    NormalizeToolCall(ctx, toolCall) (standardFormat, error)
}
```

### Provider Implementations
```go
// All providers implement same interface
openaiClient := openai.NewOpenAIClient(apiKey, model)
anthropicClient := anthropic.NewAnthropicClient(apiKey, model)
ollamaClient := ollama.NewOllamaClient(baseURL, model)
customClient := custom.NewCustomClient(baseURL, apiKey, model)

// Adapter wraps provider-specific client
adapter := adapter.NewLLMAdapter(config)
```

### Tool Call Normalization
Different providers use different formats:

**OpenAI Format:**
```json
{
  "type": "function",
  "function": {
    "name": "get_resource",
    "arguments": "{\"kind\":\"Pod\",\"name\":\"test\"}"
  }
}
```

**Anthropic Format:**
```json
{
  "type": "tool_use",
  "id": "call_123",
  "name": "get_resource",
  "input": {"kind": "Pod", "name": "test"}
}
```

**Kubilitics Standard Format (Internal):**
```json
{
  "tool_name": "get_resource",
  "args": {"kind": "Pod", "name": "test"}
}
```

The adapter normalizes ALL formats to the standard format.

---

## Cost Tracking

Kubilitics tracks token usage and estimates costs:

```go
type Usage struct {
    InputTokens  int
    OutputTokens int
    TotalCost    float64 // Based on provider pricing
}
```

**User sees in UI:**
```
Investigation #123
Tokens: 12,450 input, 3,200 output
Estimated cost: $0.52 (OpenAI gpt-4o)
```

**Budget alerts:**
- User sets budget: "$10/month for AI"
- Warning at 80%: "You've used $8 of your $10 budget"
- Stop at 100%: "Budget exceeded, investigations paused"

---

## Security

### API Key Storage
1. **In-Memory (Runtime):** Decrypted in kubilitics-ai process memory
2. **At-Rest (Config):** Encrypted with master key
3. **In-Transit:** HTTPS only, direct to LLM provider
4. **Logs:** API keys never logged (redacted as `***REDACTED***`)

### Key Rotation
- User can change API key anytime
- Old key immediately invalidated
- In-flight requests may fail (user warned)
- New key used for all new requests

### Secure Defaults
- No default API key bundled
- No "trial" account with Kubilitics key
- User MUST bring their own key
- Clear messaging: "Your key, your data, your control"

---

## OpenAI-Compatible Ecosystem

Most self-hosted LLM servers use OpenAI-compatible APIs:

**Supported Out of Box:**
- vLLM (production inference server)
- LocalAI (local inference)
- LM Studio (desktop app)
- Text Generation WebUI (oobabooga)
- Hugging Face Text Generation Inference
- Any FastAPI server following OpenAI spec

**User Setup:**
```yaml
llm:
  provider: custom
  base_url: http://localhost:8000/v1
  model: meta-llama/Llama-3-70b-instruct
  # No API key needed for local
```

---

## Migration Path

**From other tools to Kubilitics:**
- User already has OpenAI key → Works immediately
- User already has Anthropic key → Works immediately
- User using local Ollama → Works immediately
- User using ChatGPT Plus → Can use same API key

**Future LLM Providers:**
- New providers add OpenAI-compatible endpoint → Works
- Custom fine-tuned models → Works via custom provider
- Multi-model ensembles → Works via custom provider

---

## Implementation Status

### ✅ **Completed:**
- [x] Unified LLM Adapter architecture
- [x] Anthropic provider (Claude 3.5 Sonnet, Opus, Haiku)
- [x] Provider configuration structure
- [x] Graceful degradation design
- [x] Cost tracking design

### 🚧 **In Progress:**
- [ ] OpenAI provider (gpt-4, gpt-4o, gpt-3.5-turbo)
- [ ] Ollama provider (local models)
- [ ] Custom provider (OpenAI-compatible)
- [ ] UI for provider configuration
- [ ] API key encryption/storage
- [ ] Budget tracking implementation

### 📋 **Planned:**
- [ ] Provider switching without restart
- [ ] Multi-provider support (fallback chains)
- [ ] Cost optimization recommendations
- [ ] Model selection wizard

---

## Summary

Kubilitics AI is **NOT** an OpenAI wrapper or Anthropic reseller.

It's a **BYO-LLM platform** where:
- ✅ User owns the relationship with their LLM provider
- ✅ User controls costs directly
- ✅ User can use local/free models (Ollama)
- ✅ Zero vendor lock-in from Kubilitics
- ✅ Full privacy and compliance control
- ✅ Future-proof architecture

**Our goal:** Make Kubilitics the #1 open-source Kubernetes AI platform used by millions, with NO dependency on our infrastructure or LLM partnerships.

**User value:** Kubilitics provides the intelligence layer. You provide the LLM. We never touch your data or API keys.
