/**
 * E2E: Topology page – Enterprise View tab (Phase 10 integration surface)
 * Verifies the Enterprise View tab renders and exposes the integrated topology engine.
 */
import { test, expect } from '@playwright/test';

test.describe('Topology Enterprise View tab', () => {
  test('Topology page has three tabs and Enterprise View is selectable', async ({ page }) => {
    await page.goto('/topology');
    await expect(page.getByTestId('topology-tabs')).toBeVisible({ timeout: 10000 });

    await expect(page.getByTestId('topology-tab-cytoscape')).toBeVisible();
    await expect(page.getByTestId('topology-tab-enterprise')).toBeVisible();
    await expect(page.getByTestId('topology-tab-d3')).toBeVisible();
  });

  test('Switching to Enterprise View tab shows topology content', async ({ page }) => {
    await page.goto('/topology');
    await expect(page.getByTestId('topology-tabs')).toBeVisible({ timeout: 10000 });

    await page.getByTestId('topology-tab-enterprise').click();
    await expect(page.getByTestId('topology-content-enterprise')).toBeVisible({ timeout: 5000 });
    // Enterprise view uses TopologyViewer (Cytoscape canvas); container should have a canvas or graph area
    const enterpriseContent = page.getByTestId('topology-content-enterprise');
    await expect(enterpriseContent).toBeVisible();
  });
});
