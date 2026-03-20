import { test, expect, Page } from '@playwright/test';

// T6.11 — Playwright E2E: AddOns Installed tab + Lifecycle panel
// Covers: installed tab empty state, installed table, row navigation,
//         detail page Management tab visibility, LifecyclePanel sections.

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

const CERT_MANAGER_ENTRY = {
    id: 'cert-manager',
    name: 'cert-manager',
    display_name: 'Cert Manager',
    description: 'Automated TLS certificate management for Kubernetes',
    tier: 'CORE',
    version: '1.14.0',             // latest in catalog
    k8s_compat_min: '1.25',
    helm_repo_url: 'https://charts.jetstack.io',
    helm_chart: 'cert-manager',
    helm_chart_version: 'v1.14.0',
    tags: ['security', 'tls'],
    is_deprecated: false,
    maintainer: 'Kubilitics',
};

const CERT_MANAGER_DETAIL = {
    ...CERT_MANAGER_ENTRY,
    dependencies: [],
    conflicts: [],
    crds_owned: [],
    rbac_required: [],
    cost_models: [],
};

// Installed add-on fixture
const INSTALLED_CERT_MANAGER = {
    id: 'install-abc001',
    cluster_id: 'test-cluster',
    addon_id: 'cert-manager',
    release_name: 'cert-manager',
    namespace: 'cert-manager',
    installed_version: '1.13.3',    // slightly older than catalog — "Update Available" badge
    status: 'INSTALLED',
    helm_revision: 1,
    installed_at: '2026-01-10T08:00:00Z',
    updated_at: '2026-01-10T08:00:00Z',
    catalog_entry: CERT_MANAGER_ENTRY,
    health: {
        install_id: 'install-abc001',
        ready_pods: 1,
        total_pods: 1,
        last_error: null,
        last_checked_at: '2026-02-25T12:00:00Z',
    },
    policy: {
        install_id: 'install-abc001',
        policy: 'CONSERVATIVE',
        auto_upgrade_enabled: false,
        next_available_version: '1.14.0',
        updated_at: '2026-01-10T08:00:00Z',
    },
};

async function injectCluster(page: Page): Promise<void> {
    await page.evaluate((state) => {
        window.localStorage.setItem('kubilitics-cluster', JSON.stringify(state));
    }, CLUSTER_STATE);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test.describe('AddOns — Installed tab', () => {
    test.beforeEach(async ({ page }) => {
        await page.route('**/health', (route) =>
            route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"ok"}' })
        );
        await page.route('**/api/v1/version', (route) =>
            route.fulfill({ status: 200, contentType: 'application/json', body: '{"version":"1.0.0"}' })
        );

        // Catalog (needed by CatalogBrowser on the Catalog tab)
        await page.route('**/api/v1/addons/catalog**', (route) =>
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify([CERT_MANAGER_ENTRY]),
            })
        );

        await page.goto('/');
        await injectCluster(page);
    });

    // ── 1. Empty state ────────────────────────────────────────────────────────

    test('empty state shown when no addons are installed', async ({ page }) => {
        await page.route('**/api/v1/clusters/*/addons/installed', (route) =>
            route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
        );

        await page.goto('/addons');

        // Click the "Installed" tab
        await page.getByRole('tab', { name: /installed/i }).click();

        await expect(page.getByText('No add-ons installed')).toBeVisible();
    });

    // ── 2. Table with installed addons ────────────────────────────────────────

    test('table rows render installed addons with name, status, namespace, version', async ({ page }) => {
        await page.route('**/api/v1/clusters/*/addons/installed', (route) =>
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify([INSTALLED_CERT_MANAGER]),
            })
        );

        await page.goto('/addons');
        await page.getByRole('tab', { name: /installed/i }).click();

        // Addon name column
        await expect(page.getByText('Cert Manager')).toBeVisible();

        // Namespace badge
        await expect(page.getByText('cert-manager').first()).toBeVisible();

        // Version column
        await expect(page.getByText('v1.13.3')).toBeVisible();

        // "Update Available" indicator (installed 1.13.3, catalog 1.14.0)
        await expect(page.getByText('Update Available')).toBeVisible();
    });

    // ── 3. Table row click navigates to detail page ───────────────────────────

    test('clicking an installed row navigates to the addon detail page', async ({ page }) => {
        await page.route('**/api/v1/clusters/*/addons/installed', (route) =>
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify([INSTALLED_CERT_MANAGER]),
            })
        );
        await page.route('**/api/v1/addons/catalog/cert-manager', (route) =>
            route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CERT_MANAGER_DETAIL) })
        );

        await page.goto('/addons');
        await page.getByRole('tab', { name: /installed/i }).click();
        await expect(page.getByText('Cert Manager')).toBeVisible();

        // Click the row (first occurrence of the name inside the table)
        await page.getByRole('row', { name: /cert manager/i }).click();

        await expect(page).toHaveURL(/\/addons\/cert-manager/);
        await expect(page.getByRole('heading', { name: 'Cert Manager' })).toBeVisible();
    });

    // ── 4. No cluster selected placeholder ────────────────────────────────────

    test('no-cluster placeholder shown when activeCluster is null', async ({ page }) => {
        // Inject state without an active cluster
        await page.evaluate(() => {
            const state = {
                state: { activeCluster: null, isOnboarded: true },
                version: 0,
            };
            window.localStorage.setItem('kubilitics-cluster', JSON.stringify(state));
        });

        await page.goto('/addons');
        await page.getByRole('tab', { name: /installed/i }).click();

        await expect(page.getByText('No cluster selected')).toBeVisible();
    });
});

test.describe('AddOns — Detail page lifecycle', () => {
    test.beforeEach(async ({ page }) => {
        await page.route('**/health', (route) =>
            route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"ok"}' })
        );
        await page.route('**/api/v1/version', (route) =>
            route.fulfill({ status: 200, contentType: 'application/json', body: '{"version":"1.0.0"}' })
        );
        await page.route('**/api/v1/addons/catalog/cert-manager', (route) =>
            route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CERT_MANAGER_DETAIL) })
        );
        await page.route('**/api/v1/addons/catalog**', (route) =>
            route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([CERT_MANAGER_ENTRY]) })
        );
        await page.route('**/api/v1/clusters/*/addons/catalog/*/rbac', (route) =>
            route.fulfill({ status: 200, contentType: 'text/plain', body: '# No RBAC changes' })
        );

        await page.goto('/');
        await injectCluster(page);
    });

    // ── 5. Management tab hidden when not installed ───────────────────────────

    test('Management and Audit Log tabs are hidden when addon is not installed', async ({ page }) => {
        await page.route('**/api/v1/clusters/*/addons/installed', (route) =>
            route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
        );

        await page.goto('/addons/cert-manager');
        await expect(page.getByRole('heading', { name: 'Cert Manager' })).toBeVisible();

        // Overview and Security tabs should be present
        await expect(page.getByRole('tab', { name: 'Overview' })).toBeVisible();
        await expect(page.getByRole('tab', { name: /security/i })).toBeVisible();

        // Management and Audit Log tabs should NOT appear
        await expect(page.getByRole('tab', { name: /management/i })).not.toBeVisible();
        await expect(page.getByRole('tab', { name: /audit/i })).not.toBeVisible();
    });

    // ── 6. Management tab visible when addon is installed ─────────────────────

    test('Management and Audit Log tabs appear when addon is installed', async ({ page }) => {
        await page.route('**/api/v1/clusters/*/addons/installed', (route) =>
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify([INSTALLED_CERT_MANAGER]),
            })
        );

        await page.goto('/addons/cert-manager');
        await expect(page.getByRole('heading', { name: 'Cert Manager' })).toBeVisible();

        // Installed badge
        await expect(page.getByText('Installed')).toBeVisible();

        // Management and Audit Log tabs now present
        await expect(page.getByRole('tab', { name: /management/i })).toBeVisible();
        await expect(page.getByRole('tab', { name: /audit/i })).toBeVisible();
    });

    // ── 7. Lifecycle panel renders health and upgrade data ────────────────────

    test('Management tab shows LifecyclePanel with health and policy sections', async ({ page }) => {
        await page.route('**/api/v1/clusters/*/addons/installed', (route) =>
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify([INSTALLED_CERT_MANAGER]),
            })
        );

        await page.goto('/addons/cert-manager');
        await expect(page.getByRole('heading', { name: 'Cert Manager' })).toBeVisible();

        // Click the Management tab
        await page.getByRole('tab', { name: /management/i }).click();

        // LifecyclePanel cards: Health & Performance, Upgrade Policy, Recent Activity
        await expect(page.getByText('Health & Performance')).toBeVisible();
        await expect(page.getByText('Upgrade Policy')).toBeVisible();
        await expect(page.getByText('Recent Activity')).toBeVisible();

        // Health data
        await expect(page.getByText('1 / 1 Ready')).toBeVisible();

        // Upgrade policy
        await expect(page.getByText('CONSERVATIVE')).toBeVisible();

        // Next available version badge (1.14.0 is available)
        await expect(page.getByText(/v1\.14\.0 available/)).toBeVisible();

        // Action buttons
        await expect(page.getByRole('button', { name: /upgrade/i })).toBeVisible();
        await expect(page.getByRole('button', { name: /rollback/i })).toBeVisible();
        await expect(page.getByRole('button', { name: /uninstall/i })).toBeVisible();
    });

    // ── 8. Installed badge and Quick Actions shown in sidebar ─────────────────

    test('Quick Actions card replaces Install card when addon is installed', async ({ page }) => {
        await page.route('**/api/v1/clusters/*/addons/installed', (route) =>
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify([INSTALLED_CERT_MANAGER]),
            })
        );

        await page.goto('/addons/cert-manager');
        await expect(page.getByRole('heading', { name: 'Cert Manager' })).toBeVisible();

        // "Install Add-on" button should NOT appear (addon already installed)
        await expect(page.getByRole('button', { name: 'Install Add-on' })).not.toBeVisible();

        // Quick Actions card should appear instead
        await expect(page.getByText('Quick Actions')).toBeVisible();
    });

    // ── 9. Detail not found state ─────────────────────────────────────────────

    test('Not Found state shows when catalog entry is missing', async ({ page }) => {
        await page.route('**/api/v1/addons/catalog/does-not-exist', (route) =>
            route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not found"}' })
        );
        await page.route('**/api/v1/clusters/*/addons/installed', (route) =>
            route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
        );

        await page.goto('/addons/does-not-exist');

        await expect(page.getByText('Add-on Not Found')).toBeVisible();
        await expect(page.getByRole('link', { name: /back to catalog/i })).toBeVisible();
    });
});
