# kcli Deployment Guide

This guide covers deploying kcli with kubilitics-backend in different environments.

## Overview

kcli is a Kubernetes CLI tool that provides enhanced kubectl functionality. It is integrated into kubilitics-backend and can be used via the shell panel or API endpoints.

## Requirements

- **kubectl**: kcli requires kubectl to be installed and available in PATH
- **kcli binary**: The kcli binary must be available to the backend service

## Deployment Methods

### Desktop App Deployment

kcli is automatically bundled with the desktop app.

**Build Process:**
1. Build kcli binary: `./scripts/build-kcli-for-desktop.sh`
2. Build desktop app: `cd kubilitics-desktop && npm run tauri build`

**Verification:**
- Run `./scripts/verify-desktop-build.sh` to verify kcli is bundled
- Check `kubilitics-desktop/binaries/kcli-*` exists
- Verify `tauri.conf.json` includes `"binaries/kcli"` in `externalBin`

**Configuration:**
- kcli binary is automatically resolved from bundled binaries
- `KCLI_BIN` environment variable is set by the desktop app sidecar

### Docker Deployment

kcli is included in the backend Docker image.

**Build Process:**
```bash
docker build -f kubilitics-backend/Dockerfile -t kubilitics-backend .
```

**Verification:**
- Run `./scripts/verify-docker-build.sh` to verify kcli is included
- Test: `docker run --rm kubilitics-backend kcli version`
- Verify kcli binary exists at `/usr/local/bin/kcli`
- Verify `KCLI_BIN=/usr/local/bin/kcli` environment variable is set

**Configuration:**
- kcli binary is built during Docker image build (multi-stage build)
- Installed to `/usr/local/bin/kcli`
- `KCLI_BIN` environment variable is set in Dockerfile

### Helm Deployment

When using Helm charts, configure kcli settings in `values.yaml`:

```yaml
kcli:
  enabled: true
  binaryPath: "/usr/local/bin/kcli"  # Path to kcli binary in container
  shellModeAllowed: false  # Conservative default for multi-tenant
  rateLimitPerSec: 12
  rateLimitBurst: 24
  streamMaxConns: 4

backend:
  env:
    - name: KCLI_BIN
      value: "/usr/local/bin/kcli"
    - name: KCLI_ALLOW_SHELL_MODE
      value: "false"
```

**RBAC Permissions:**
Ensure the service account has required permissions:
- `pods/exec` - For pod exec operations
- `pods/attach` - For pod attach operations

## Environment Variables

### KCLI_BIN

**Description:** Path to the kcli binary

**Default:** Auto-detected (checks KCLI_BIN env var, PATH, or relative path)

**Examples:**
- Desktop: Set automatically by sidecar
- Docker: `/usr/local/bin/kcli`
- Custom: `/opt/kcli/bin/kcli`

### KCLI_ALLOW_SHELL_MODE

**Description:** Allow interactive shell mode (`/kcli/stream?mode=shell`)

**Default:** `true` (can be disabled for security)

**Values:**
- `true` - Allow interactive shell mode
- `false` - Disable interactive shell mode (TUI mode still works)

### AI_BACKEND_URL

**Description:** AI backend URL for kcli AI commands

**Default:** `http://localhost:8081`

**Usage:** Set this to enable AI-enhanced kcli commands (`kcli ai`, `kcli why`, etc.)

## Troubleshooting

### kcli Binary Not Found

**Symptoms:**
- Error: "kcli binary not found"
- Shell panel fails to connect
- API returns 503 Service Unavailable

**Solutions:**
1. **Desktop App:**
   - Verify kcli binary exists in `kubilitics-desktop/binaries/`
   - Rebuild kcli: `./scripts/build-kcli-for-desktop.sh`
   - Rebuild desktop app

2. **Docker:**
   - Verify Dockerfile includes kcli build stage
   - Rebuild Docker image
   - Check `KCLI_BIN` environment variable

3. **Custom Deployment:**
   - Install kcli: `cd kcli && go build -o bin/kcli ./cmd/kcli`
   - Set `KCLI_BIN` environment variable
   - Ensure kcli is in PATH

### kubectl Not Found

**Symptoms:**
- kcli commands fail
- Error: "kubectl: command not found"

**Solutions:**
- Install kubectl: https://kubernetes.io/docs/tasks/tools/
- Ensure kubectl is in PATH
- Desktop app shows warning banner if kubectl is missing

### Shell Mode Disabled

**Symptoms:**
- Error: "kcli shell mode is disabled by server policy"
- Only TUI mode works

**Solutions:**
- Set `KCLI_ALLOW_SHELL_MODE=true` in backend configuration
- For Helm: Set `kcli.shellModeAllowed: true` in values.yaml

## API Endpoints

### kcli Exec
- **Endpoint:** `POST /api/v1/clusters/{clusterId}/kcli/exec`
- **Auth:** Operator role required
- **Body:** `{"args": ["get", "pods", "-A"], "force": false}`

### kcli Stream (TUI)
- **Endpoint:** `GET /api/v1/clusters/{clusterId}/kcli/stream?mode=ui`
- **Auth:** Operator role required
- **Protocol:** WebSocket PTY

### kcli Stream (Shell)
- **Endpoint:** `GET /api/v1/clusters/{clusterId}/kcli/stream?mode=shell`
- **Auth:** Operator role required
- **Protocol:** WebSocket PTY
- **Requires:** `KCLI_ALLOW_SHELL_MODE=true`

### kcli Completion
- **Endpoint:** `GET /api/v1/clusters/{clusterId}/kcli/complete?line=...`
- **Auth:** Viewer role required

## Security Considerations

1. **Shell Mode:** Disable shell mode in multi-tenant environments
2. **Rate Limiting:** Configure rate limits to prevent abuse
3. **RBAC:** Ensure proper RBAC permissions are configured
4. **Binary Validation:** Verify kcli binary integrity in production

## Monitoring

Monitor kcli usage via:
- Backend logs (kcli binary resolution, command execution)
- Audit logs (all kcli commands are logged)
- Metrics (when implemented)

## Support

For issues or questions:
- Check troubleshooting guide: `docs/TROUBLESHOOTING_KCLI.md`
- Review build documentation: `kcli/BUILD.md`
- Open an issue on GitHub
