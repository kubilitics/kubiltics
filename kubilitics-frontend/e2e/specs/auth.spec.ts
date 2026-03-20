import { test, expect } from '@playwright/test';
import { ConnectionPage } from '../page-objects/ConnectionPage';

test.describe('Authentication & Cluster Connection', () => {
    let connectionPage: ConnectionPage;

    test.beforeEach(async ({ page }) => {
        connectionPage = new ConnectionPage(page);
        await connectionPage.goto();
    });

    test('should show mode selection on first visit', async ({ page }) => {
        await expect(page.locator('text=Choose your journey.')).toBeVisible({ timeout: 15000 });
        await expect(page.locator('h3:has-text("Desktop Engine")')).toBeVisible();
        await expect(page.locator('h3:has-text("In-Cluster OS")')).toBeVisible();
    });

    test('should navigate to cluster connect when Desktop mode is selected', async ({ page }) => {
        await connectionPage.selectDesktopMode();
        await expect(page.locator('text=Connect Your Cluster')).toBeVisible();
    });

    test('should show In-Cluster connection details when In-Cluster mode is selected', async ({ page }) => {
        await connectionPage.selectInClusterMode();
        await expect(page.locator('text=In-Cluster Connection')).toBeVisible();
        await expect(page.locator('text=Service Account Detected')).toBeVisible();
    });

    test('should support demo mode', async ({ page }) => {
        await connectionPage.selectDesktopMode();
        await page.locator('text=Explore Demo Mode').click();
        await expect(page).toHaveURL(/\/dashboard/);
    });
});
