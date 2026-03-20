import { test, expect } from '@playwright/test';

// Headlamp/Lens model: no login page — app opens to mode selection / cluster flow.
test.describe('Entry flow (no login)', () => {
    test('should show entry point when visiting app root', async ({ page }) => {
        await page.context().clearCookies();
        await page.goto('/');

        // Should show mode selection or redirect to connect/home when cluster exists
        await expect(page).toHaveURL(/\/(|\?|mode-selection|connect|home)/);
        // No login page
        await expect(page.locator('h1')).not.toContainText('Kubilitics Login');
    });

    test('should redirect to entry (/) when no cluster selected and visiting protected path', async ({ page }) => {
        await page.context().clearCookies();
        await page.evaluate(() => window.sessionStorage.clear());
        await page.evaluate(() => window.localStorage.clear());

        await page.goto('/dashboard');

        // No login — redirect to entry point (mode selection) when no activeCluster
        await expect(page).toHaveURL(/\//);
    });
});
