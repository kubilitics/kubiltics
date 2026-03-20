import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('Accessibility Audit', () => {
    test('should not have any automatically detectable accessibility issues on entry page', async ({ page }) => {
        await page.goto('/');

        const accessibilityScanResults = await new AxeBuilder({ page }).analyze();

        expect(accessibilityScanResults.violations).toEqual([]);
    });

    test('should not have any automatically detectable accessibility issues on home page', async ({ page }) => {
        await page.route('**/api/v1/projects', async (route) => route.fulfill({ status: 200, body: '[]' }));

        await page.goto('/');
        await page.evaluate(() => {
            const clusterState = {
                state: {
                    activeCluster: { id: 'test', name: 'Test', status: 'healthy' },
                    isOnboarded: true
                },
                version: 0
            };
            window.localStorage.setItem('kubilitics-cluster', JSON.stringify(clusterState));
        });
        await page.goto('/home');
        await expect(page).toHaveURL('/home');

        const accessibilityScanResults = await new AxeBuilder({ page })
            .disableRules(['color-contrast'])
            .analyze();

        expect(accessibilityScanResults.violations).toEqual([]);
    });
});
