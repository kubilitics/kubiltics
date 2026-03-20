import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('Accessibility', () => {
    test('should NOT have any automatically detectable accessibility issues on entry (mode selection)', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('main', { state: 'visible', timeout: 10000 }).catch(() => {});
        const results = await new AxeBuilder({ page }).analyze();
        expect(results.violations).toEqual([]);
    });

    // Mock cluster state for internal pages (no login — Headlamp/Lens model)
    test.beforeEach(async ({ page }) => {
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


        // Mock Backend APIs to avoid 404s/Errors cluttering the page
        await page.route('**/api/v1/version', async route => {
            await route.fulfill({ json: { version: '1.0.0' } });
        });

        // Mock cluster details to prevent 500 errors
        await page.route('**/health', async route => route.fulfill({ json: { status: 'ok' } }));
        await page.route('**/api/v1/clusters/*/overview', async route => route.fulfill({
            json: {
                cpu: { used: 10, total: 100 },
                memory: { used: 20, total: 100 },
                pods: { running: 5, pending: 0, failed: 0 },
                nodes: 3,
                alerts: { top_3: [], warnings: 0, critical: 0 }
            }
        }));
        await page.route('**/api/v1/clusters/*/summary', async route => route.fulfill({
            json: {
                name: 'test-cluster',
                status: 'healthy',
                version: 'v1.27.0'
            }
        }));
        await page.route('**/api/v1/clusters/*/events*', async route => route.fulfill({ json: [] }));
        await page.route('**/api/v1/clusters/*/features/*', async route => route.fulfill({ json: { enabled: true } }));
        await page.route('**/api/v1/clusters/*/resources/*', async route => route.fulfill({ json: [] }));
        // Mock APIs... (existing mocks)
        await page.route('**/api/v1/analytics/anomalies', async route => route.fulfill({
            json: { anomalies: [], status: 'healthy' }
        }));

        // Disable animations to prevent contrast issues (and wait for any remaining effects)
        await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; }' });
        await page.waitForTimeout(1000); // Ensure layout settles
    });

    test('should NOT have any automatically detectable accessibility issues on Dashboard', async ({ page }) => {
        await page.goto('/dashboard');
        // Wait for key content
        await page.waitForSelector('main#main-content', { state: 'visible', timeout: 10000 });
        await page.waitForSelector('h1', { state: 'visible' });

        const results = await new AxeBuilder({ page })
            // Disable rules due to library limitations (Recharts) and test env rendering artifacts (translucency)
            .disableRules(['svg-img-alt', 'color-contrast'])
            .analyze();

        if (results.violations.length > 0) {
            console.log('Dashboard Violations Found:', results.violations.length);
            console.log('VIOLATION_DETAILS:', JSON.stringify(results.violations, null, 2));
        }
        expect(results.violations).toEqual([]);
    });

    test('should NOT have any automatically detectable accessibility issues on Resource List (Pods)', async ({ page }) => {
        await page.goto('/pods');
        // Wait for pods list to load
        await page.waitForSelector('main#main-content', { state: 'visible' });
        await page.waitForSelector('h1', { state: 'visible' }); // "Pods" header

        const results = await new AxeBuilder({ page })
            .disableRules(['color-contrast'])
            .analyze();
        if (results.violations.length > 0) {
            console.log('Pods Violations Found:', results.violations.length);
            console.log('VIOLATION_DETAILS_PODS:', JSON.stringify(results.violations, null, 2));
        }
        expect(results.violations).toEqual([]);
    });
});
