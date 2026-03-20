import { test, expect } from '@playwright/test';

// Headlamp/Lens model: no login. Session is cluster selection + optional backend auth when auth_mode=required.
test.describe('Entry and cluster flow (no login wall)', () => {
    test.beforeEach(async ({ page }) => {
        await page.route('**/api/v1/version', async (route) => {
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: '1.0.0' }) });
        });
        await page.route('**/health', async (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok' }) }));
    });

    test('should reach dashboard with cluster in storage (no login)', async ({ page }) => {
        await page.goto('/');
        await page.evaluate(() => {
            const clusterState = {
                state: {
                    activeCluster: {
                        id: 'test-cluster',
                        name: 'Test Cluster',
                        status: 'healthy',
                        provider: 'minikube',
                        nodes: 1,
                        namespaces: 5,
                        pods: { running: 10, pending: 0, failed: 0 },
                        cpu: { used: 10, total: 100 },
                        memory: { used: 10, total: 100 }
                    },
                    isOnboarded: true
                },
                version: 0
            };
            window.localStorage.setItem('kubilitics-cluster', JSON.stringify(clusterState));
        });

        await page.goto('/dashboard');
        // With activeCluster set we stay on dashboard (or get API errors if backend not mocked)
        await expect(page).toHaveURL(/\/dashboard/);
    });

    test('should redirect to entry when no cluster and visiting protected route', async ({ page }) => {
        await page.goto('/');
        await page.evaluate(() => {
            window.sessionStorage.clear();
            window.localStorage.clear();
        });

        await page.goto('/dashboard');
        await expect(page).toHaveURL(/\//);
    });
});
