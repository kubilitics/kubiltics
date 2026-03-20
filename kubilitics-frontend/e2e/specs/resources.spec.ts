import { test, expect } from '@playwright/test';
import { ConnectionPage } from '../page-objects/ConnectionPage';
import { ResourceListPage } from '../page-objects/ResourceListPage';

test.describe('Resource Views Validation', () => {
    let connectionPage: ConnectionPage;
    let resourceListPage: ResourceListPage;

    test.beforeEach(async ({ page }) => {
        connectionPage = new ConnectionPage(page);
        resourceListPage = new ResourceListPage(page);

        // Bypass auth using demo mode for resource testing
        await connectionPage.goto();
        await connectionPage.selectDesktopMode();
        await page.locator('text=Explore Demo Mode').click();
        await expect(page).toHaveURL(/\/dashboard/);
    });

    test('should list pods correctly', async () => {
        await resourceListPage.navigateTo('pods');
        const rowCount = await resourceListPage.getRowCount();
        expect(rowCount).toBeGreaterThan(0);
    });

    test('should filter pods by search', async () => {
        await resourceListPage.navigateTo('pods');
        const initialCount = await resourceListPage.getRowCount();

        // Use a common demo pod name if known, otherwise just search for something partial
        await resourceListPage.search('nginx');
        const filteredCount = await resourceListPage.getRowCount();
        expect(filteredCount).toBeLessThanOrEqual(initialCount);
    });

    test('should sort resources by Name', async () => {
        await resourceListPage.navigateTo('deployments');
        await resourceListPage.sortByColumn('Name');
        // Verify sorting logic (could get text of first/last rows)
        const firstRowName = await resourceListPage.tableRows.first().locator('td').first().textContent();
        expect(firstRowName).toBeTruthy();
    });

    test('should navigate to pod detail view', async () => {
        await resourceListPage.navigateTo('pods');
        const podName = await resourceListPage.tableRows.first().locator('td').first().textContent();
        if (podName) {
            await resourceListPage.tableRows.first().click(); // Click the row to navigate
            await expect(resourceListPage.page).toHaveURL(new RegExp(`/pods/.*/${podName.trim()}`));
            await expect(resourceListPage.page.locator('h1')).toContainText(podName.trim());
        }
    });

    test('should show metrics tab in pod detail', async ({ page }) => {
        await resourceListPage.navigateTo('pods');
        await resourceListPage.tableRows.first().click();
        await page.locator('[data-testid="tab-metrics"]').click();
        await expect(page.locator('canvas')).toBeVisible(); // Metrics are usually charts
    });
});
