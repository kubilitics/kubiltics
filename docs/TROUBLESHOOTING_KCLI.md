# kcli Troubleshooting Guide

Common issues and solutions for kcli integration.

## Table of Contents

1. [kcli Binary Not Found](#kcli-binary-not-found)
2. [kubectl Not Found](#kubectl-not-found)
3. [Shell Mode Disabled](#shell-mode-disabled)
4. [WebSocket Connection Issues](#websocket-connection-issues)
5. [Rate Limiting](#rate-limiting)
6. [AI Commands Not Working](#ai-commands-not-working)
7. [Plugin Execution Issues](#plugin-execution-issues)

## kcli Binary Not Found

### Symptoms
- Error: "kcli binary not found"
- HTTP 503 Service Unavailable
- Shell panel fails to connect
- Backend logs show: "kcli binary resolution failed"

### Solutions

#### Desktop App
1. **Verify kcli is bundled:**
   ```bash
   ls -la kubilitics-desktop/binaries/kcli-*
   ```

2. **Rebuild kcli:**
   ```bash
   ./scripts/build-kcli-for-desktop.sh
   ```

3. **Rebuild desktop app:**
   ```bash
   cd kubilitics-desktop && npm run tauri build
   ```

4. **Check tauri.conf.json:**
   - Verify `"binaries/kcli"` is in `externalBin` array

#### Docker Deployment
1. **Verify Dockerfile includes kcli build:**
   ```bash
   grep -A 10 "kcli" kubilitics-backend/Dockerfile
   ```

2. **Rebuild Docker image:**
   ```bash
   docker build -f kubilitics-backend/Dockerfile -t kubilitics-backend .
   ```

3. **Test kcli in container:**
   ```bash
   docker run --rm kubilitics-backend kcli version
   ```

4. **Check KCLI_BIN environment variable:**
   ```bash
   docker run --rm kubilitics-backend printenv KCLI_BIN
   ```

#### Custom Deployment
1. **Build kcli binary:**
   ```bash
   cd kcli && go build -ldflags="-s -w" -o bin/kcli ./cmd/kcli
   ```

2. **Set KCLI_BIN environment variable:**
   ```bash
   export KCLI_BIN=/path/to/kcli/bin/kcli
   ```

3. **Or add to PATH:**
   ```bash
   export PATH=$PATH:/path/to/kcli/bin
   ```

### Debug Steps
1. Check backend logs for binary resolution attempts
2. Verify file permissions: `chmod +x /path/to/kcli`
3. Test binary directly: `/path/to/kcli version`
4. Check environment variables: `printenv KCLI_BIN`

## kubectl Not Found

### Symptoms
- kcli commands fail
- Error: "kubectl: command not found"
- Desktop app shows warning banner

### Solutions

1. **Install kubectl:**
   - Follow: https://kubernetes.io/docs/tasks/tools/
   - Or use package manager:
     ```bash
     # macOS
     brew install kubectl
     
     # Linux
     curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
     chmod +x kubectl
     sudo mv kubectl /usr/local/bin/
     ```

2. **Verify installation:**
   ```bash
   kubectl version --client
   ```

3. **Check PATH:**
   ```bash
   which kubectl
   echo $PATH
   ```

### Desktop App
- Desktop app validates kubectl on startup
- Warning banner appears if kubectl is missing
- Click "Installation Guide" button for instructions

## Shell Mode Disabled

### Symptoms
- Error: "kcli shell mode is disabled by server policy"
- Only TUI mode (`mode=ui`) works
- Shell mode (`mode=shell`) returns 403 Forbidden

### Solutions

1. **Enable shell mode in backend config:**
   ```yaml
   kcli_allow_shell_mode: true
   ```

2. **Or set environment variable:**
   ```bash
   export KCLI_ALLOW_SHELL_MODE=true
   ```

3. **For Helm deployment:**
   ```yaml
   kcli:
     shellModeAllowed: true
   ```

### Security Note
- Shell mode provides full interactive shell access
- Disable in multi-tenant environments
- Use TUI mode (`mode=ui`) for safer access

## WebSocket Connection Issues

### Symptoms
- Shell panel shows "Connecting..." indefinitely
- WebSocket connection fails
- "Reconnecting..." indicator appears repeatedly

### Solutions

1. **Check backend is running:**
   ```bash
   curl http://localhost:819/health
   ```

2. **Verify WebSocket URL:**
   - Desktop: `ws://localhost:819/api/v1/clusters/{id}/kcli/stream`
   - Web: `ws://{backend-url}/api/v1/clusters/{id}/kcli/stream`

3. **Check CSP (Content Security Policy):**
   - Desktop: Verify `tauri.conf.json` allows WebSocket connections
   - Should include: `ws://localhost:819`

4. **Check firewall/proxy:**
   - Ensure WebSocket connections are not blocked
   - Check proxy settings

5. **Review backend logs:**
   - Look for WebSocket connection errors
   - Check for rate limiting messages

### Auto-Reconnect
- Shell panel automatically reconnects on connection loss
- Maximum 5 reconnect attempts
- Exponential backoff (1s to 30s delay)

## Rate Limiting

### Symptoms
- Error: "kcli exec rate limit exceeded"
- Error: "too many concurrent kcli streams"
- HTTP 429 Too Many Requests

### Solutions

1. **Adjust rate limits in config:**
   ```yaml
   kcli_rate_limit_per_sec: 12
   kcli_rate_limit_burst: 24
   kcli_stream_max_conns: 4
   ```

2. **Increase limits temporarily:**
   ```bash
   export KCLI_RATE_LIMIT_PER_SEC=24
   export KCLI_RATE_LIMIT_BURST=48
   ```

3. **Reduce concurrent connections:**
   - Close unused shell panels
   - Limit number of simultaneous users

### Default Limits
- Exec: 12 requests/second, burst 24
- Stream: 4 concurrent connections per cluster

## AI Commands Not Working

### Symptoms
- `kcli ai` commands fail
- Error: "AI integration disabled"
- AI commands return empty results

### Solutions

1. **Verify AI backend is running:**
   ```bash
   curl http://localhost:8081/health
   ```

2. **Set AI backend URL:**
   ```yaml
   ai_backend_url: "http://localhost:8081"
   ```

3. **Check environment variables:**
   ```bash
   printenv KCLI_AI_ENDPOINT
   printenv KCLI_AI_PROVIDER
   ```

4. **Verify AI backend configuration:**
   - AI backend must be running
   - Must provide OpenAI-compatible API
   - Check AI backend logs

### Configuration
AI commands require:
- AI backend running (default: `http://localhost:8081`)
- `KCLI_AI_ENDPOINT` environment variable set
- `KCLI_AI_PROVIDER=openai` (for OpenAI-compatible API)

## Plugin Execution Issues

### Symptoms
- Plugin commands fail
- Error: "plugin not found"
- Plugin execution blocked

### Solutions

1. **Verify plugin is installed:**
   ```bash
   kcli plugin list
   ```

2. **Install plugin:**
   ```bash
   kcli plugin install <plugin-name>
   ```

3. **Check plugin permissions:**
   ```bash
   kcli plugin inspect <plugin-name>
   ```

4. **Allow plugin permissions:**
   ```bash
   kcli plugin allow <plugin-name>
   ```

### Plugin Policy
- Plugins are allowed in exec endpoint
- Plugin execution via PTY stream works
- Check plugin manifest for required permissions

## Debugging

### Enable Debug Logging

**Backend:**
```yaml
log_level: debug
```

**Check logs:**
```bash
# Docker
docker logs <container-id>

# Desktop
# Check backend logs in app data directory
```

### Common Log Locations

**Desktop App:**
- macOS: `~/Library/Application Support/kubilitics/logs/`
- Linux: `~/.local/share/kubilitics/logs/`
- Windows: `%APPDATA%\kubilitics\logs\`

**Docker:**
- Container stdout/stderr
- Or mounted log volume

### Test kcli Directly

```bash
# Test binary
./bin/kcli version

# Test with kubeconfig
KUBECONFIG=/path/to/kubeconfig ./bin/kcli get pods

# Test completion
./bin/kcli completion bash
```

## Getting Help

1. **Check documentation:**
   - Deployment: `docs/DEPLOYMENT_KCLI.md`
   - Build: `kcli/BUILD.md`

2. **Review logs:**
   - Backend logs
   - Browser console (for frontend issues)
   - System logs

3. **Open an issue:**
   - Include error messages
   - Provide reproduction steps
   - Attach relevant logs

4. **Community support:**
   - GitHub Discussions
   - Discord/Slack (if available)
