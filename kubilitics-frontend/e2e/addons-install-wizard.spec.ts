import { test, expect, Page } from '@playwright/test';

// T6.11 — Playwright E2E: AddOns Install Wizard
// Covers: opening wizard, plan step (namespace + Resolve Plan), preflight step, wizard navigation.

// ─── Shared fixtures ─────────────────────────────────────────────────────────

const CLUSTER_STATE = {
    state: {
        activeCluster: {
            id: 'test-cluster',
            name: 'Test Cluster',
            status: 'healthy',
            provider: 'minikube',
            nodes: 3,
            namespaces: 5,
            pods: { running: 10, pending: 0, failed: 0 },
            cpu: { used: 20, total: 100 },
            memory: { used: 30, total: 100 },
        },
        isOnboarded: true,
    },
    version: 0,
};

const CERT_MANAGER_DETAIL = {
    id: 'cert-manager',
    name: 'cert-manager',
    display_name: 'Cert Manager',
    description: 'Automated TLS certificate management for Kubernetes',
    tier: 'CORE',
    version: '1.13.3',
    k8s_compat_min: '1.25',
    helm_repo_url: 'https://charts.jetstack.io',
    helm_chart: 'cert-manager',
    helm_chart_version: 'v1.13.3',
    tags: ['security', 'tls'],
    is_deprecated: false,
    maintainer: 'Kubilitics',
    dependencies: [],
    conflicts: [],
    crds_owned: [],
    rbac_required: [],
    cost_models: [],
};

// Mock plan response — includes plan_id which the wizard sidebar and PreflightStep rely on
const MOCK_PLAN = {
    plan_id: 'plan-abc12345',
    requested_addon_id: 'cert-manager',
    cluster_id: 'test-cluster',
    steps: [
        {
            name: 'cert-manager',
            action: 'INSTALL',
            addon_id: 'cert-manager',
            addon_name: 'cert-manager',
            to_version: '1.13.3',
            namespace: 'cert-manager',
            release_name: 'cert-manager',
            reason: 'Not currently installed on the cluster',
            is_required: true,
            dependency_depth: 0,
            estimated_duration_sec: 120,
            estimated_cost_delta_usd: 12.50,
        },
    ],
    total_estimated_duration_sec: 300,
    estimated_time_seconds: 300,
    total_estimated_cost_delta_usd: 12.50,
    has_conflicts: false,
    conflict_reasons: [],
    generated_at: '2026-02-25T00:00:00Z',
};

// Mock cost estimate response
const MOCK_COST_ESTIMATE = {
    total_monthly_usd: 12.50,
    breakdown: [],
};

// Mock preflight report — all checks pass (status "GO")
const MOCK_PREFLIGHT = {
    cluster_id: 'test-cluster',
    addon_id: 'cert-manager',
    status: 'GO',              // field name used by PreflightStep component
    overall_status: 'GO',      // field name from backend model
    checks: [
        {
            type: 'rbac',
            status: 'GO',
            title: 'RBAC Permissions',
            detail: 'All required permissions are available',
            passed: true,
            name: 'RBAC Check',
            message: 'All required RBAC permissions are present',
            severity: 'INFO',
        },
        {
            type: 'k8s_version',
            status: 'GO',
            title: 'K8s Version Compatibility',
            detail: 'Cluster version 1.28 meets the requirement ≥ 1.25',
            passed: true,
            name: 'K8s Version',
            message: 'Compatible with cluster version 1.28',
            severity: 'INFO',
        },
    ],
    blockers: [],
    warnings: [],
    rbac_diff: null,
    resource_estimates: [],
    generated_at: '2026-02-25T00:00:00Z',
};

async function injectCluster(page: Page): Promise<void> {
    await page.evaluate((state) => {
        window.localStorage.setItem('kubilitics-cluster', JSON.stringify(state));
    }, CLUSTER_STATE);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test.describe('AddOns — Install Wizard', () => {
    test.beforeEach(async ({ page }) => {
        await page.route('**/health', (route) =>
            route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"ok"}' })
        );
        await page.route('**/api/v1/version', (route) =>
            route.fulfill({ status: 200, contentType: 'application/json', body: '{"version":"1.0.0"}' })
        );

        // Catalog endpoints
        await page.route('**/api/v1/addons/catalog/cert-manager', (route) =>
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(CERT_MANAGER_DETAIL),
            })
        );
        await page.route('**/api/v1/addons/catalog**', (route) =>
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify([CERT_MANAGER_DETAIL]),
            })
        );

        // Installed addons — empty so detail page shows "Install Add-on" button
        await page.route('**/api/v1/clusters/*/addons/installed', (route) =>
            route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
        );

        // RBAC manifest (loaded by Security tab — may fire in background)
        await page.route('**/api/v1/clusters/*/addons/catalog/*/rbac', (route) =>
            route.fulfill({ status: 200, contentType: 'text/plain', body: '# No RBAC changes' })
        );

        await page.goto('/');
        await injectCluster(page);
    });

    // ── 1. Open wizard ────────────────────────────────────────────────────────

    test('Install Add-on button opens the wizard dialog at step 1 (Plan)', async ({ page }) => {
        await page.goto('/addons/cert-manager');

        // Wait for addon detail to load
        await expect(page.getByRole('heading', { name: 'Cert Manager' })).toBeVisible();

        // Click Install button
        await page.getByRole('button', { name: 'Install Add-on' }).click();

        // Wizard dialog should open
        await expect(page.getByRole('dialog')).toBeVisible();

        // Step 1 title is "Plan"
        await expect(page.getByRole('dialog').getByText('Plan')).toBeVisible();

        // Namespace input with default "default" value
        await expect(page.getByRole('dialog').getByDisplayValue('default')).toBeVisible();

        // "Resolve Plan" button is present
        await expect(page.getByRole('button', { name: 'Resolve Plan' })).toBeVisible();
    });

    // ── 2. Plan step resolves and shows execution plan ────────────────────────

    test('Resolve Plan call returns a plan and displays it in the wizard', async ({ page }) => {
        // Mock plan + cost estimate
        await page.route('**/api/v1/clusters/*/addons/plan', (route) =>
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(MOCK_PLAN),
            })
        );
        await page.route('**/api/v1/clusters/*/addons/estimate-cost', (route) =>
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(MOCK_COST_ESTIMATE),
            })
        );

        await page.goto('/addons/cert-manager');
        await expect(page.getByRole('heading', { name: 'Cert Manager' })).toBeVisible();
        await page.getByRole('button', { name: 'Install Add-on' }).click();
        await expect(page.getByRole('dialog')).toBeVisible();

        // Click Resolve Plan
        await page.getByRole('button', { name: 'Resolve Plan' }).click();

        // Plan summary should appear — "Execution Plan" heading and the step name
        await expect(page.getByText('Execution Plan')).toBeVisible();
        await expect(page.getByText('cert-manager')).toBeVisible();
        await expect(page.getByText('INSTALL')).toBeVisible();

        // "Next" button should now be enabled
        await expect(page.getByRole('button', { name: /next/i })).toBeEnabled();
    });

    // ── 3. Next button disabled until plan resolved ───────────────────────────

    test('Next button is disabled in step 1 before plan is resolved', async ({ page }) => {
        await page.goto('/addons/cert-manager');
        await page.getByRole('button', { name: 'Install Add-on' }).click();
        await expect(page.getByRole('dialog')).toBeVisible();

        // Next is disabled before Resolve Plan
        await expect(page.getByRole('button', { name: /next/i })).toBeDisabled();
    });

    // ── 4. Navigating to step 2 (Preflight) ──────────────────────────────────

    test('advancing to step 2 shows Preflight and runs checks automatically', async ({ page }) => {
        await page.route('**/api/v1/clusters/*/addons/plan', (route) =>
            route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_PLAN) })
        );
        await page.route('**/api/v1/clusters/*/addons/estimate-cost', (route) =>
            route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_COST_ESTIMATE) })
        );
        await page.route('**/api/v1/clusters/*/addons/preflight', (route) =>
            route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_PREFLIGHT) })
        );

        await page.goto('/addons/cert-manager');
        await page.getByRole('button', { name: 'Install Add-on' }).click();
        await expect(page.getByRole('dialog')).toBeVisible();

        // Resolve plan
        await page.getByRole('button', { name: 'Resolve Plan' }).click();
        await expect(page.getByText('Execution Plan')).toBeVisible();

        // Advance to step 2
        await page.getByRole('button', { name: /next/i }).click();

        // Step title "Preflight" should be visible (in sidebar + main header)
        await expect(page.getByRole('dialog').getByText('Preflight')).toBeVisible();

        // Preflight result: "Status: Ready" (report.status === 'GO')
        await expect(page.getByText(/Status: Ready/i)).toBeVisible();
    });

    // ── 5. Wizard can be closed ───────────────────────────────────────────────

    test('Cancel button closes the wizard', async ({ page }) => {
        await page.goto('/addons/cert-manager');
        await page.getByRole('button', { name: 'Install Add-on' }).click();
        await expect(page.getByRole('dialog')).toBeVisible();

        await page.getByRole('button', { name: 'Cancel' }).click();

        await expect(page.getByRole('dialog')).not.toBeVisible();
    });

    test('Back button returns to previous step', async ({ page }) => {
        await page.route('**/api/v1/clusters/*/addons/plan', (route) =>
            route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_PLAN) })
        );
        await page.route('**/api/v1/clusters/*/addons/estimate-cost', (route) =>
            route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_COST_ESTIMATE) })
        );
        await page.route('**/api/v1/clusters/*/addons/preflight', (route) =>
            route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_PREFLIGHT) })
        );

        await page.goto('/addons/cert-manager');
        await page.getByRole('button', { name: 'Install Add-on' }).click();
        await expect(page.getByRole('dialog')).toBeVisible();

        // Advance to step 2
        await page.getByRole('button', { name: 'Resolve Plan' }).click();
        await expect(page.getByText('Execution Plan')).toBeVisible();
        await page.getByRole('button', { name: /next/i }).click();
        await expect(page.getByRole('dialog').getByText('Preflight')).toBeVisible();

        // Go back
        await page.getByRole('button', { name: /back/i }).click();

        // Should be at step 1 again
        await expect(page.getByRole('dialog').getByText('Execution Plan')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Resolve Plan' })).not.toBeVisible();
    });

    // ── 6. Plan resolution error ──────────────────────────────────────────────

    test('plan resolution error shows an alert in the wizard', async ({ page }) => {
        await page.route('**/api/v1/clusters/*/addons/plan', (route) =>
            route.fulfill({ status: 409, contentType: 'application/json', body: '{"error":"conflict detected"}' })
        );
        await page.route('**/api/v1/clusters/*/addons/estimate-cost', (route) =>
            route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_COST_ESTIMATE) })
        );

        await page.goto('/addons/cert-manager');
        await page.getByRole('button', { name: 'Install Add-on' }).click();
        await expect(page.getByRole('dialog')).toBeVisible();

        await page.getByRole('button', { name: 'Resolve Plan' }).click();

        // Error alert should appear in the step content
        await expect(page.getByText('Resolution Error')).toBeVisible();
    });
});
