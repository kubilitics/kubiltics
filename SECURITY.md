# Security Policy

For the project roadmap and task list (including security-related tasks), see **[TASKS.md](TASKS.md)**. For secure defaults, RBAC, and secrets handling, see **docs/** (e.g. [SECURE-DEFAULTS.md](docs/SECURE-DEFAULTS.md), [SECURITY-RBAC.md](docs/SECURITY-RBAC.md), [SECURITY-SECRETS.md](docs/SECURITY-SECRETS.md)).

## Supported Versions

We release patches for security vulnerabilities in the following versions:

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

The Kubilitics team takes security bugs seriously. We appreciate your efforts to responsibly disclose your findings.

### Where to Report

**DO NOT** create a public GitHub issue for security vulnerabilities.

Instead:

1. **Email**: Send details to [email protected]
2. **Subject**: "[SECURITY] Brief description"
3. **Include**:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

### What to Expect

- **Acknowledgment**: Within 48 hours
- **Initial Assessment**: Within 7 days
- **Status Updates**: Every 7 days until resolved
- **Fix Timeline**: Depends on severity
  - **Critical**: 7 days
  - **High**: 30 days
  - **Medium**: 90 days
  - **Low**: Next release cycle

### Disclosure Policy

We follow coordinated disclosure:

1. Security issue reported
2. Fix developed and tested
3. Security advisory published
4. Fix released
5. Public disclosure (after users have time to update)

### Bug Bounty

Currently, we do not have a formal bug bounty program. However:

- We will credit you in release notes (if desired)
- Swag and recognition for significant findings
- Future bug bounty program planned

## Security Best Practices

### For Users

1. **Keep Updated**: Always use the latest version
2. **Verify Downloads**: Check signatures on binaries
3. **Secure Kubeconfig**: Protect your kubeconfig files
4. **Network Security**: Use firewalls appropriately
5. **RBAC**: Follow principle of least privilege in K8s

### For Contributors

1. **Dependencies**: Keep dependencies updated
2. **Secrets**: Never commit secrets or credentials
3. **Input Validation**: Always validate user input
4. **Error Handling**: Don't leak sensitive info in errors
5. **Code Review**: Security-focused reviews required

## Known Security Considerations

### Desktop Application

- Backend runs as child process (localhost only)
- No authentication (local use only)
- File system access limited to kubeconfig
- WebView sandboxed

### Mobile Application

- HTTPS required for all connections
- Biometric authentication required
- Keychain/Keystore for sensitive data
- Certificate pinning recommended

### Backend

- No built-in authentication (designed for localhost)
- Respects Kubernetes RBAC
- Input validation on all endpoints
- Rate limiting implemented

## Security Advisories

Security advisories will be published:

1. GitHub Security Advisories
2. Release notes
3. Website blog
4. Email to subscribers

## Hall of Thanks

We thank the following researchers for responsible disclosure:

(List will be maintained here)

---

For non-security bugs, please use [GitHub Issues](https://github.com/kubilitics/kubilitics/issues).
