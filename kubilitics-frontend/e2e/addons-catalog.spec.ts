import { test, expect, Page } from '@playwright/test';

// T6.11 — Playwright E2E: AddOns Catalog tab
// Covers: catalog load, tier filtering, search, navigation to detail, empty/error states.

// ─── Shared fixtures ────────────────────────────────────────────────────────

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

const CERT_MANAGER = {
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
};

const PROMETHEUS = {
    id: 'prometheus',
    name: 'prometheus',
    display_name: 'Prometheus',
    description: 'Monitoring and alerting toolkit for Kubernetes clusters',
    tier: 'CORE',
    version: '0.68.0',
    k8s_compat_min: '1.24',
    helm_repo_url: 'https://prometheus-community.github.io/helm-charts',
    helm_chart: 'kube-prometheus-stack',
    helm_chart_version: '55.0.0',
    tags: ['monitoring', 'metrics'],
    is_deprecated: false,
    maintainer: 'Kubilitics',
};

const FALCO = {
    id: 'falco',
    name: 'falco',
    display_name: 'Falco Runtime Security',
    description: 'Cloud-native runtime security and threat detection',
    tier: 'COMMUNITY',
    version: '3.8.4',
    k8s_compat_min: '1.24',
    helm_repo_url: 'https://falcosecurity.github.io/charts',
    helm_chart: 'falco',
    helm_chart_version: '3.8.4',
    tags: ['security', 'runtime'],
    is_deprecated: false,
    maintainer: 'Falco Community',
};

const ALL_ADDONS = [CERT_MANAGER, PROMETHEUS, FALCO];
const CORE_ADDONS = ALL_ADDONS.filter(a => a.tier === 'CORE');
const COMMUNITY_ADDONS = ALL_ADDONS.filter(a => a.tier === 'COMMUNITY');

/** Injects cluster state into localStorage so ProtectedRoute allows access. */
async function injectCluster(page: Page): Promise<void> {
    await page.evaluate((state) => {
        window.localStorage.setItem('kubilitics-cluster', JSON.stringify(state));
    }, CLUSTER_STATE);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test.describe('AddOns — Catalog tab', () => {
    test.beforeEach(async ({ page }) => {
        // Health / version stubs so the app doesn't show a "backend down" banner
        await page.route('**/health', (route) =>
            route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"ok"}' })
        );
        await page.route('**/api/v1/version', (route) =>
            route.fulfill({ status: 200, contentType: 'application/json', body: '{"version":"1.0.0"}' })
        );

        // Catalog: return tier-filtered data based on query param
        await page.route('**/api/v1/addons/catalog**', (route) => {
            const url = new URL(route.request().url());
            const tier = url.searchParams.get('tier');
            let data = ALL_ADDONS;
            if (tier === 'CORE') data = CORE_ADDONS;
            if (tier === 'COMMUNITY') data = COMMUNITY_ADDONS;
            route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
        });

        // Installed addons — empty so no "Active" badges interfere with catalog tests
        await page.route('**/api/v1/clusters/*/addons/installed', (route) =>
            route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
        );

        // Inject cluster, then navigate
        await page.goto('/');
        await injectCluster(page);
    });

    // ── 1. Basic load ─────────────────────────────────────────────────────────

    test('page header and all addon cards render', async ({ page }) => {
        await page.goto('/addons');

        await expect(page.getByText('Add-ons Platform')).toBeVisible();

        // Catalog tab is active by default — all mock addons should be visible
        await expect(page.getByText('Cert Manager')).toBeVisible();
        await expect(page.getByText('Prometheus')).toBeVisible();
        await expect(page.getByText('Falco Runtime Security')).toBeVisible();
    });

    // ── 2. Tier filter: Curated (CORE) ────────────────────────────────────────

    test('Curated filter shows only CORE addons', async ({ page }) => {
        await page.goto('/addons');
        // Wait for initial load
        await expect(page.getByText('Cert Manager')).toBeVisible();

        // Click the "Curated" tier filter
        await page.getByText('Curated').click();

        // CORE addons present
        await expect(page.getByText('Cert Manager')).toBeVisible();
        await expect(page.getByText('Prometheus')).toBeVisible();
        // COMMUNITY addon must not appear
        await expect(page.getByText('Falco Runtime Security')).not.toBeVisible();
    });

    // ── 3. Tier filter: Community ─────────────────────────────────────────────

    test('Community filter shows only COMMUNITY addons', async ({ page }) => {
        await page.goto('/addons');
        await expect(page.getByText('Falco Runtime Security')).toBeVisible();

        await page.getByText('Community').click();

        await expect(page.getByText('Falco Runtime Security')).toBeVisible();
        await expect(page.getByText('Cert Manager')).not.toBeVisible();
        await expect(page.getByText('Prometheus')).not.toBeVisible();
    });

    // ── 4. Search (client-side filtering) ─────────────────────────────────────

    test('search input filters addon cards by display name', async ({ page }) => {
        await page.goto('/addons');
        await expect(page.getByText('Cert Manager')).toBeVisible();

        await page.getByPlaceholder('Search add-ons...').fill('cert');

        // Only Cert Manager should remain visible
        await expect(page.getByText('Cert Manager')).toBeVisible();
        await expect(page.getByText('Prometheus')).not.toBeVisible();
        await expect(page.getByText('Falco Runtime Security')).not.toBeVisible();
    });

    test('clearing search restores full catalog', async ({ page }) => {
        await page.goto('/addons');
        const searchInput = page.getByPlaceholder('Search add-ons...');

        await searchInput.fill('falco');
        await expect(page.getByText('Cert Manager')).not.toBeVisible();

        // Clear search
        await searchInput.fill('');
        await expect(page.getByText('Cert Manager')).toBeVisible();
        await expect(page.getByText('Prometheus')).toBeVisible();
        await expect(page.getByText('Falco Runtime Security')).toBeVisible();
    });

    // ── 5. Navigation to detail page ─────────────────────────────────────────

    test('clicking an addon card navigates to the detail page', async ({ page }) => {
        // Stub the catalog-entry detail endpoint
        await page.route('**/api/v1/addons/catalog/cert-manager', (route) =>
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    ...CERT_MANAGER,
                    dependencies: [],
                    conflicts: [],
                    crds_owned: [],
                    rbac_required: [],
                    cost_models: [],
                }),
            })
        );

        await page.goto('/addons');
        await expect(page.getByText('Cert Manager')).toBeVisible();

        // Click the Cert Manager card
        await page.getByText('Cert Manager').first().click();

        await expect(page).toHaveURL(/\/addons\/cert-manager/);
        // Detail page renders the addon's display name as a heading
        await expect(page.getByRole('heading', { name: 'Cert Manager' })).toBeVisible();
    });

    // ── 6. Empty state ────────────────────────────────────────────────────────

    test('empty state displays when catalog returns no addons', async ({ page }) => {
        await page.route('**/api/v1/addons/catalog**', (route) =>
            route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
        );

        await page.goto('/addons');
        await expect(page.getByText('No add-ons found')).toBeVisible();
    });

    // ── 7. Error state ────────────────────────────────────────────────────────

    test('error state shows when catalog API returns 500', async ({ page }) => {
        await page.route('**/api/v1/addons/catalog**', (route) =>
            route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"internal error"}' })
        );

        await page.goto('/addons');
        await expect(page.getByText('Failed to load catalog')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Try Again' })).toBeVisible();
    });
});
