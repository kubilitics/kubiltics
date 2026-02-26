package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"
)

const (
	ProviderAnthropic   = "anthropic"
	ProviderOpenAI      = "openai"
	ProviderAzureOpenAI = "azure-openai"
	ProviderOllama      = "ollama"
	ProviderCustom      = "custom"
)

type Config struct {
	Enabled          bool
	Provider         string
	Endpoint         string
	APIKey           string
	Model            string
	Timeout          time.Duration
	AzureDeployment  string
	AzureAPIVersion  string
	BudgetMonthlyUSD float64
	SoftLimitPercent float64
	// MaxInputChars caps total prompt input (0 = no limit).
	MaxInputChars int
}

type Resource struct {
	Identifier string
	Action     string
}

type Event struct {
	Type    string
	Reason  string
	Message string
}

type Issue struct {
	Resource    string
	Description string
}

type ClusterContext struct {
	Context   string
	Namespace string
	Snapshot  string
}

type AIAnalysis struct {
	Result string
}

type AISummary struct {
	Result string
}

type AIFix struct {
	Result string
}

type Provider interface {
	Name() string
	Validate(apiKey string) error
	Analyze(ctx context.Context, resource *Resource) (*AIAnalysis, error)
	Summarize(ctx context.Context, events []Event) (*AISummary, error)
	SuggestFix(ctx context.Context, issue *Issue) (*AIFix, error)
	Query(ctx context.Context, question string, cluster *ClusterContext) (string, error)
}

type queryProvider struct {
	name       string
	apiKey     string
	validateFn func(string) error
	queryFn    func(context.Context, string) (string, error)
}

func (q *queryProvider) Name() string { return q.name }

func (q *queryProvider) Validate(apiKey string) error {
	if q.validateFn == nil {
		return nil
	}
	return q.validateFn(strings.TrimSpace(apiKey))
}

func (q *queryProvider) Analyze(ctx context.Context, resource *Resource) (*AIAnalysis, error) {
	action := "explain"
	target := "cluster resource"
	if resource != nil {
		if strings.TrimSpace(resource.Action) != "" {
			action = strings.TrimSpace(resource.Action)
		}
		if strings.TrimSpace(resource.Identifier) != "" {
			target = strings.TrimSpace(resource.Identifier)
		}
	}
	prompt := fmt.Sprintf("You are a Kubernetes SRE. %s this target and provide concise, actionable output with probable causes and verification commands. Target: %s", action, target)
	result, err := q.queryFn(ctx, prompt)
	if err != nil {
		return nil, err
	}
	return &AIAnalysis{Result: result}, nil
}

func (q *queryProvider) Summarize(ctx context.Context, events []Event) (*AISummary, error) {
	if len(events) == 0 {
		result, err := q.queryFn(ctx, "Summarize current Kubernetes events and highlight only warnings, failures, and next actions.")
		if err != nil {
			return nil, err
		}
		return &AISummary{Result: result}, nil
	}
	parts := make([]string, 0, len(events))
	for _, e := range events {
		parts = append(parts, strings.TrimSpace(e.Type+" "+e.Reason+" "+e.Message))
	}
	prompt := "Summarize these Kubernetes events with priorities and suggested checks:\n" + strings.Join(parts, "\n")
	result, err := q.queryFn(ctx, prompt)
	if err != nil {
		return nil, err
	}
	return &AISummary{Result: result}, nil
}

func (q *queryProvider) SuggestFix(ctx context.Context, issue *Issue) (*AIFix, error) {
	target := "resource"
	detail := ""
	if issue != nil {
		if strings.TrimSpace(issue.Resource) != "" {
			target = strings.TrimSpace(issue.Resource)
		}
		detail = strings.TrimSpace(issue.Description)
	}
	prompt := fmt.Sprintf("Suggest safe Kubernetes fixes for %s. Include commands and rollback notes. Context: %s", target, detail)
	result, err := q.queryFn(ctx, prompt)
	if err != nil {
		return nil, err
	}
	return &AIFix{Result: result}, nil
}

func (q *queryProvider) Query(ctx context.Context, question string, cluster *ClusterContext) (string, error) {
	question = strings.TrimSpace(question)
	if question == "" {
		question = "Give Kubernetes operational advice for the current context."
	}
	if cluster != nil && (cluster.Context != "" || cluster.Namespace != "" || cluster.Snapshot != "") {
		question = fmt.Sprintf("Context=%s Namespace=%s\n%s\nQuestion: %s", cluster.Context, cluster.Namespace, cluster.Snapshot, question)
	}
	return q.queryFn(ctx, question)
}

func NewProvider(cfg Config) (Provider, error) {
	cfg = cfg.normalized()
	if cfg.Provider == "" {
		return nil, nil
	}
	httpClient := &http.Client{Timeout: cfg.Timeout}
	var p *queryProvider
	switch cfg.Provider {
	case ProviderOpenAI:
		p = newOpenAIProvider(cfg, httpClient)
	case ProviderAnthropic:
		p = newAnthropicProvider(cfg, httpClient)
	case ProviderAzureOpenAI:
		p = newAzureOpenAIProvider(cfg, httpClient)
	case ProviderOllama:
		p = newOllamaProvider(cfg, httpClient)
	case ProviderCustom:
		p = newCustomProvider(cfg, httpClient)
	default:
		return nil, fmt.Errorf("unsupported AI provider %q", cfg.Provider)
	}
	if err := p.Validate(cfg.APIKey); err != nil {
		return p, err
	}
	return p, nil
}

func (c Config) normalized() Config {
	c.Provider = strings.ToLower(strings.TrimSpace(c.Provider))
	c.Endpoint = strings.TrimSpace(c.Endpoint)
	c.APIKey = strings.TrimSpace(c.APIKey)
	c.Model = strings.TrimSpace(c.Model)
	c.AzureDeployment = strings.TrimSpace(c.AzureDeployment)
	c.AzureAPIVersion = strings.TrimSpace(c.AzureAPIVersion)
	if c.Timeout <= 0 {
		c.Timeout = 8 * time.Second
	}
	if c.SoftLimitPercent <= 0 {
		c.SoftLimitPercent = 80
	}
	if c.SoftLimitPercent >= 100 {
		c.SoftLimitPercent = 99
	}
	if c.Provider == ProviderOpenAI {
		if c.Endpoint == "" {
			c.Endpoint = "https://api.openai.com"
		}
		if c.Model == "" {
			c.Model = "gpt-4o-mini"
		}
	}
	if c.Provider == ProviderAnthropic {
		if c.Endpoint == "" {
			c.Endpoint = "https://api.anthropic.com"
		}
		if c.Model == "" {
			c.Model = "claude-3-5-sonnet-latest"
		}
	}
	if c.Provider == ProviderAzureOpenAI {
		if c.Model == "" {
			c.Model = "gpt-4o-mini"
		}
		if c.AzureAPIVersion == "" {
			c.AzureAPIVersion = "2024-02-15-preview"
		}
	}
	if c.Provider == ProviderOllama {
		if c.Endpoint == "" {
			c.Endpoint = "http://localhost:11434"
		}
		if c.Model == "" {
			c.Model = "llama3.1"
		}
	}
	return c
}

func newOpenAIProvider(cfg Config, httpClient *http.Client) *queryProvider {
	endpoint := strings.TrimSuffix(cfg.Endpoint, "/") + "/v1/chat/completions"
	return &queryProvider{
		name:       ProviderOpenAI,
		apiKey:     cfg.APIKey,
		validateFn: validateOpenAIKey,
		queryFn: func(ctx context.Context, question string) (string, error) {
			payload := map[string]any{
				"model": cfg.Model,
				"messages": []map[string]string{
					{"role": "system", "content": "You are a Kubernetes SRE expert. Be concise and practical."},
					{"role": "user", "content": question},
				},
				"temperature": 0.2,
			}
			var out struct {
				Choices []struct {
					Message struct {
						Content string `json:"content"`
					} `json:"message"`
				} `json:"choices"`
			}
			if err := postJSON(ctx, httpClient, endpoint, payload, map[string]string{
				"Authorization": "Bearer " + cfg.APIKey,
			}, &out); err != nil {
				return "", err
			}
			if len(out.Choices) == 0 {
				return "", fmt.Errorf("openai: empty choices")
			}
			return strings.TrimSpace(out.Choices[0].Message.Content), nil
		},
	}
}

func newAnthropicProvider(cfg Config, httpClient *http.Client) *queryProvider {
	endpoint := strings.TrimSuffix(cfg.Endpoint, "/") + "/v1/messages"
	return &queryProvider{
		name:       ProviderAnthropic,
		apiKey:     cfg.APIKey,
		validateFn: validateAnthropicKey,
		queryFn: func(ctx context.Context, question string) (string, error) {
			payload := map[string]any{
				"model":      cfg.Model,
				"max_tokens": 1024,
				"messages": []map[string]string{
					{"role": "user", "content": question},
				},
			}
			var out struct {
				Content []struct {
					Type string `json:"type"`
					Text string `json:"text"`
				} `json:"content"`
			}
			if err := postJSON(ctx, httpClient, endpoint, payload, map[string]string{
				"x-api-key":         cfg.APIKey,
				"anthropic-version": "2023-06-01",
			}, &out); err != nil {
				return "", err
			}
			for _, c := range out.Content {
				if strings.TrimSpace(c.Text) != "" {
					return strings.TrimSpace(c.Text), nil
				}
			}
			return "", fmt.Errorf("anthropic: empty content")
		},
	}
}

func newAzureOpenAIProvider(cfg Config, httpClient *http.Client) *queryProvider {
	endpoint := strings.TrimSuffix(cfg.Endpoint, "/") + "/openai/deployments/" + cfg.AzureDeployment + "/chat/completions?api-version=" + cfg.AzureAPIVersion
	return &queryProvider{
		name:   ProviderAzureOpenAI,
		apiKey: cfg.APIKey,
		validateFn: func(apiKey string) error {
			if strings.TrimSpace(cfg.Endpoint) == "" {
				return fmt.Errorf("azure-openai endpoint is required (KCLI_AZURE_OPENAI_ENDPOINT)")
			}
			if strings.TrimSpace(cfg.AzureDeployment) == "" {
				return fmt.Errorf("azure-openai deployment is required (KCLI_AZURE_OPENAI_DEPLOYMENT)")
			}
			return validateGenericAPIKey("azure-openai", apiKey)
		},
		queryFn: func(ctx context.Context, question string) (string, error) {
			payload := map[string]any{
				"messages": []map[string]string{
					{"role": "system", "content": "You are a Kubernetes SRE expert. Be concise and practical."},
					{"role": "user", "content": question},
				},
				"temperature": 0.2,
			}
			var out struct {
				Choices []struct {
					Message struct {
						Content string `json:"content"`
					} `json:"message"`
				} `json:"choices"`
			}
			if err := postJSON(ctx, httpClient, endpoint, payload, map[string]string{
				"api-key": cfg.APIKey,
			}, &out); err != nil {
				return "", err
			}
			if len(out.Choices) == 0 {
				return "", fmt.Errorf("azure-openai: empty choices")
			}
			return strings.TrimSpace(out.Choices[0].Message.Content), nil
		},
	}
}

func newOllamaProvider(cfg Config, httpClient *http.Client) *queryProvider {
	endpoint := strings.TrimSuffix(cfg.Endpoint, "/") + "/api/chat"
	return &queryProvider{
		name:       ProviderOllama,
		apiKey:     cfg.APIKey,
		validateFn: func(string) error { return nil },
		queryFn: func(ctx context.Context, question string) (string, error) {
			payload := map[string]any{
				"model":  cfg.Model,
				"stream": false,
				"messages": []map[string]string{
					{"role": "user", "content": question},
				},
			}
			var out struct {
				Message struct {
					Content string `json:"content"`
				} `json:"message"`
			}
			if err := postJSON(ctx, httpClient, endpoint, payload, nil, &out); err != nil {
				return "", err
			}
			if strings.TrimSpace(out.Message.Content) == "" {
				return "", fmt.Errorf("ollama: empty message content")
			}
			return strings.TrimSpace(out.Message.Content), nil
		},
	}
}

func newCustomProvider(cfg Config, httpClient *http.Client) *queryProvider {
	endpoint := strings.TrimSpace(cfg.Endpoint)
	return &queryProvider{
		name:   ProviderCustom,
		apiKey: cfg.APIKey,
		validateFn: func(_ string) error {
			if endpoint == "" {
				return fmt.Errorf("custom endpoint is required (set KCLI_AI_ENDPOINT)")
			}
			return nil
		},
		queryFn: func(ctx context.Context, question string) (string, error) {
			payload := map[string]any{
				"action": "query",
				"target": question,
			}
			var out map[string]any
			headers := map[string]string{}
			if cfg.APIKey != "" {
				headers["Authorization"] = "Bearer " + cfg.APIKey
			}
			if err := postJSON(ctx, httpClient, endpoint, payload, headers, &out); err != nil {
				return "", err
			}
			if v, ok := out["result"].(string); ok && strings.TrimSpace(v) != "" {
				return strings.TrimSpace(v), nil
			}
			if choices, ok := out["choices"].([]any); ok && len(choices) > 0 {
				if c0, ok := choices[0].(map[string]any); ok {
					if msg, ok := c0["message"].(map[string]any); ok {
						if content, ok := msg["content"].(string); ok {
							return strings.TrimSpace(content), nil
						}
					}
				}
			}
			b, _ := json.Marshal(out)
			return strings.TrimSpace(string(b)), nil
		},
	}
}

func postJSON(ctx context.Context, httpClient *http.Client, url string, payload any, headers map[string]string, out any) error {
	b, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(b))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	for k, v := range headers {
		if strings.TrimSpace(v) != "" {
			req.Header.Set(k, v)
		}
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}
	if resp.StatusCode >= 400 {
		msg := strings.TrimSpace(string(body))
		if len(msg) > 240 {
			msg = msg[:240]
		}
		return fmt.Errorf("ai provider request failed (%d): %s", resp.StatusCode, msg)
	}
	if err := json.Unmarshal(body, out); err != nil {
		return fmt.Errorf("ai provider response parse error: %w", err)
	}
	return nil
}

func validateOpenAIKey(apiKey string) error {
	apiKey = strings.TrimSpace(apiKey)
	if apiKey == "" {
		return fmt.Errorf("openai API key is required (KCLI_OPENAI_API_KEY or KCLI_AI_API_KEY)")
	}
	if !strings.HasPrefix(apiKey, "sk-") {
		return fmt.Errorf("openai API key must start with sk-")
	}
	return nil
}

func validateAnthropicKey(apiKey string) error {
	apiKey = strings.TrimSpace(apiKey)
	if apiKey == "" {
		return fmt.Errorf("anthropic API key is required (KCLI_ANTHROPIC_API_KEY or KCLI_AI_API_KEY)")
	}
	if !strings.HasPrefix(apiKey, "sk-ant-") {
		return fmt.Errorf("anthropic API key must start with sk-ant-")
	}
	return nil
}

func validateGenericAPIKey(provider, apiKey string) error {
	apiKey = strings.TrimSpace(apiKey)
	if apiKey == "" {
		return fmt.Errorf("%s API key is required", provider)
	}
	if len(apiKey) < 10 {
		return fmt.Errorf("%s API key is too short", provider)
	}
	return nil
}

var modelNameRE = regexp.MustCompile(`^[a-zA-Z0-9._:-]+$`)

func validateModelName(model string) error {
	model = strings.TrimSpace(model)
	if model == "" {
		return fmt.Errorf("model cannot be empty")
	}
	if !modelNameRE.MatchString(model) {
		return fmt.Errorf("invalid model name %q", model)
	}
	return nil
}
