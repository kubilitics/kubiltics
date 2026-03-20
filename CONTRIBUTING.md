# Contributing to Kubilitics

Thank you for your interest in contributing to Kubilitics! This document provides guidelines and instructions for contributing to this project.

## Table of Contents

1. [Code of Conduct](#code-of-conduct)
2. [Getting Started](#getting-started)
3. [Development Setup](#development-setup)
4. [Project Structure](#project-structure)
5. [Development Workflow](#development-workflow)
6. [Coding Standards](#coding-standards)
7. [Testing Requirements](#testing-requirements)
8. [Pull Request Process](#pull-request-process)
9. [Release Process](#release-process)
10. [Community](#community)

**Roadmap and tasks:** The single execution roadmap and task list (phases A–R, O, W, etc.) is in **[TASKS.md](TASKS.md)**. Use it to see what’s in scope, definition of done, and verification steps.

---

## Code of Conduct

### Our Pledge

We pledge to make participation in Kubilitics a harassment-free experience for everyone, regardless of age, body size, disability, ethnicity, gender identity, level of experience, nationality, personal appearance, race, religion, or sexual identity and orientation.

### Our Standards

**Positive behaviors:**
- Using welcoming and inclusive language
- Being respectful of differing viewpoints
- Gracefully accepting constructive criticism
- Focusing on what's best for the community
- Showing empathy towards others

**Unacceptable behaviors:**
- Trolling, insulting/derogatory comments, personal or political attacks
- Public or private harassment
- Publishing others' private information without permission
- Any conduct inappropriate in a professional setting

### Enforcement

Instances of abusive behavior may be reported to the project team. All complaints will be reviewed and investigated promptly and fairly.

---

## Getting Started

### Prerequisites

- **Go** 1.24+
- **Rust** 1.75+
- **Node.js** 20+
- **Docker** (for testing)
- **Kubernetes cluster** (kind/k3s/minikube for local development)

### Fork and Clone

```bash
# Fork the repository on GitHub
# Then clone your fork
git clone https://github.com/YOUR_USERNAME/kubilitics.git
cd kubilitics

# Add upstream remote
git remote add upstream https://github.com/kubilitics/kubilitics.git
```

---

## Development Setup

### Backend

```bash
cd kubilitics-backend

# Install dependencies
go mod download

# Run backend
go run cmd/server/main.go

# Run tests
go test ./...
```

### Desktop

```bash
cd kubilitics-desktop

# Install dependencies
npm install
cargo install tauri-cli --version ^2.0

# Build Go backend
cd ../kubilitics-backend
go build -o ../kubilitics-desktop/src-tauri/binaries/kubilitics-backend cmd/server/main.go

# Run desktop app
cd ../kubilitics-desktop
cargo tauri dev
```

### Mobile

```bash
cd kubilitics-mobile

# Install dependencies
npm install

# iOS
cargo tauri ios init
cargo tauri ios dev

# Android
cargo tauri android init
cargo tauri android dev
```

---

## Project Structure

```
Kubilitics/
├── kubilitics-backend/       Go backend services
├── kubilitics-desktop/       Tauri desktop app
├── kubilitics-frontend/      React frontend (separate repo)
├── kubilitics-mobile/        Tauri mobile app
├── kubilitics-website/       Marketing website
├── docs/                     Documentation
├── tests/                    E2E and integration tests
├── scripts/                  Build and utility scripts
└── .github/                  CI/CD workflows
```

### Component Responsibilities

- **kubilitics-backend**: Core Kubernetes integration, topology engine, REST API
- **kubilitics-desktop**: Native desktop app (macOS, Windows, Linux)
- **kubilitics-frontend**: Shared React UI components
- **kubilitics-mobile**: Native mobile app (iOS, Android)
- **kubilitics-website**: Marketing and documentation site

---

## Development Workflow

### 1. Create a Branch

```bash
# Update your fork
git checkout main
git pull upstream main

# Create a feature branch
git checkout -b feature/your-feature-name

# Or a bugfix branch
git checkout -b fix/issue-123-description
```

### 2. Make Changes

- Follow coding standards (see below)
- Write tests for new functionality
- Update documentation as needed
- Keep commits atomic and well-described

### 3. Commit Guidelines

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): subject

body (optional)

footer (optional)
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Maintenance tasks

**Examples:**

```bash
git commit -m "feat(topology): add RBAC relationship inference"
git commit -m "fix(backend): resolve memory leak in WebSocket hub"
git commit -m "docs: update installation instructions for macOS"
```

### 4. Push and Create PR

```bash
# Push to your fork
git push origin feature/your-feature-name

# Create a pull request on GitHub
```

---

## Coding Standards

### Go (Backend)

- **Format**: Use `gofmt` and `goimports`
- **Linting**: Pass `golangci-lint run`
- **Style**: Follow [Effective Go](https://golang.org/doc/effective_go)
- **Comments**: Document all exported functions and types
- **Error Handling**: Always handle errors explicitly

```go
// Good
func GetCluster(ctx context.Context, id string) (*Cluster, error) {
    cluster, err := db.Query(ctx, id)
    if err != nil {
        return nil, fmt.Errorf("failed to query cluster: %w", err)
    }
    return cluster, nil
}

// Bad
func GetCluster(ctx context.Context, id string) *Cluster {
    cluster, _ := db.Query(ctx, id)
    return cluster
}
```

### Rust (Desktop/Mobile)

- **Format**: Use `cargo fmt`
- **Linting**: Pass `cargo clippy`
- **Style**: Follow [Rust API Guidelines](https://rust-lang.github.io/api-guidelines/)
- **Comments**: Document public functions with `///`
- **Error Handling**: Use `Result<T, E>` and `?` operator

```rust
// Good
#[tauri::command]
pub async fn read_kubeconfig(path: Option<String>) -> Result<String, String> {
    let path = path.unwrap_or_else(default_kubeconfig_path);
    std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read kubeconfig: {}", e))
}

// Bad
#[tauri::command]
pub async fn read_kubeconfig(path: String) -> String {
    std::fs::read_to_string(path).unwrap()
}
```

### TypeScript/JavaScript (Frontend)

- **Format**: Use Prettier
- **Linting**: Pass ESLint
- **Style**: Follow [Airbnb Style Guide](https://github.com/airbnb/javascript)
- **Types**: Use TypeScript, avoid `any`
- **Components**: Use functional components with hooks

```typescript
// Good
interface Props {
  clusterId: string;
  onSelect: (cluster: Cluster) => void;
}

export const ClusterSelector: React.FC<Props> = ({ clusterId, onSelect }) => {
  const [clusters, setClusters] = useState<Cluster[]>([]);
  
  useEffect(() => {
    fetchClusters().then(setClusters);
  }, []);
  
  return (
    <Select value={clusterId} onChange={onSelect}>
      {clusters.map(c => <Option key={c.id} value={c.id}>{c.name}</Option>)}
    </Select>
  );
};

// Bad
export const ClusterSelector = (props: any) => {
  const [clusters, setClusters] = useState([]);
  // Missing error handling, type safety, etc.
};
```

---

## Testing Requirements

### Minimum Coverage

- **Backend**: 85% code coverage
- **Frontend**: 80% code coverage
- **Critical paths**: 100% coverage

### Test Types

#### 1. Unit Tests

```go
// kubilitics-backend/internal/topology/graph_test.go
func TestGraph_AddNode(t *testing.T) {
    graph := NewGraph()
    node := models.TopologyNode{
        ID:   "pod-123",
        Type: "Pod",
        Name: "nginx",
    }
    
    graph.AddNode(node)
    
    assert.Equal(t, 1, len(graph.Nodes))
    assert.Equal(t, "pod-123", graph.Nodes[0].ID)
}
```

#### 2. Integration Tests

```go
// kubilitics-backend/tests/integration/topology_test.go
func TestTopologyEngine_BuildGraph(t *testing.T) {
    // Set up test K8s cluster
    cluster := setupTestCluster(t)
    defer cluster.Teardown()
    
    // Create test resources
    cluster.CreatePod("test-pod")
    cluster.CreateService("test-svc")
    
    // Build topology
    engine := topology.NewEngine(cluster.Client())
    graph, err := engine.BuildGraph(context.Background(), models.TopologyFilters{})
    
    require.NoError(t, err)
    assert.GreaterOrEqual(t, len(graph.Nodes), 2)
}
```

#### 3. E2E Tests

```typescript
// tests/e2e/topology.spec.ts
import { test, expect } from '@playwright/test';

test('should display topology graph', async ({ page }) => {
  await page.goto('/topology');
  
  // Wait for graph to load
  await page.waitForSelector('[data-testid="topology-graph"]');
  
  // Check for nodes
  const nodes = await page.locator('[data-testid="topology-node"]').count();
  expect(nodes).toBeGreaterThan(0);
});
```

### Running Tests

```bash
# Backend
cd kubilitics-backend
go test -v -race -coverprofile=coverage.out ./...

# Frontend
cd kubilitics-frontend
npm test -- --coverage

# E2E
cd tests
npx playwright test
```

---

## Pull Request Process

### Before Submitting

- [ ] All tests pass locally
- [ ] Code is formatted and linted
- [ ] New features have tests
- [ ] Documentation is updated
- [ ] Commit messages follow conventions
- [ ] PR description is clear and complete

### PR Template

When creating a PR, include:

```markdown
## Description
Brief description of changes

## Related Issues
Closes #123

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing
- [ ] Unit tests added/updated
- [ ] Integration tests added/updated
- [ ] E2E tests added/updated
- [ ] Manual testing performed

## Checklist
- [ ] Code follows project style guidelines
- [ ] Self-review completed
- [ ] Documentation updated
- [ ] No new warnings introduced
```

### Review Process

1. **Automated Checks**: CI/CD must pass
2. **Code Review**: At least one maintainer approval required
3. **Testing**: Reviewers will test functionality
4. **Merge**: Squash and merge to main

### Review Timeline

- **Simple fixes**: 1-2 days
- **New features**: 3-7 days
- **Major changes**: 7-14 days

---

## Release Process

For full release automation and checklist, see **[docs/RELEASE-PROCESS.md](docs/RELEASE-PROCESS.md)**. Summary:

### Versioning

We follow [Semantic Versioning](https://semver.org/):

- **MAJOR**: Breaking changes
- **MINOR**: New features (backward compatible)
- **PATCH**: Bug fixes

### Release Workflow

1. **Create Release Branch**: `release/v1.2.0`
2. **Update Version Numbers**: All package files
3. **Update CHANGELOG**: Document all changes
4. **Create Tag**: `git tag v1.2.0`
5. **Push Tag**: Triggers CI/CD release workflow
6. **Publish Release**: GitHub release with binaries
7. **Update Documentation**: Version-specific docs

### Release Checklist

- [ ] All tests pass
- [ ] Changelog updated
- [ ] Version numbers bumped
- [ ] Release notes written
- [ ] Binaries signed
- [ ] Documentation updated
- [ ] Announcement prepared

---

## Community

### Communication Channels

- **GitHub Discussions**: General questions and discussions
- **GitHub Issues**: Bug reports and feature requests
- **Discord**: Real-time chat (link TBD)
- **Twitter**: @kubilitics (announcements)

### Getting Help

1. **Documentation**: Check docs/ first
2. **Search Issues**: Someone may have asked already
3. **Ask in Discussions**: Community Q&A
4. **File an Issue**: If you found a bug

### Becoming a Maintainer

Maintainers are contributors who have:

- Made significant contributions (10+ merged PRs)
- Demonstrated understanding of codebase
- Helped review others' contributions
- Been active in community for 3+ months

To be considered:
1. Continue contributing quality PRs
2. Help review and test others' PRs
3. Participate in discussions
4. Existing maintainers will nominate you

---

## Recognition

We value all contributions! Contributors are recognized:

- **README.md**: Contributors section
- **Release Notes**: Major contributors mentioned
- **Website**: Hall of fame page
- **Swag**: T-shirts for 10+ merged PRs

---

## Questions?

If you have questions about contributing:

1. Check this guide thoroughly
2. Search GitHub Discussions
3. Ask in Discord #contributing channel
4. Email: [email protected]

---

Thank you for contributing to Kubilitics! 🚀

**Every contribution, no matter how small, makes a difference.**
