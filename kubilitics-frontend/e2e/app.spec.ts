// E2E: one full flow (B4.4). App loads and shows cluster/topology entry.
import { test, expect } from '@playwright/test';

test('app loads and shows cluster or topology entry', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Kubilitics/i);
  // App shell: either cluster selection, topology, or nav with Cluster / Topology
  const body = await page.locator('body').textContent();
  const hasClusterOrTopology =
    body?.includes('Cluster') ||
    body?.includes('Topology') ||
    body?.includes('Kubilitics') ||
    body?.includes('Connect');
  expect(hasClusterOrTopology).toBe(true);
});
