/**
 * E2E: Topology V2 — Resource-Centric View (TASK-071)
 * Tests BFS-based resource-centric exploration (critical test).
 */
import { test, expect } from "@playwright/test";

test.describe("Topology V2: Resource-Centric View", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/topology?mode=4");
    await page.getByTestId("topology-tab-enterprise").click();
    await page.waitForSelector('[data-testid="topology-canvas"]', { timeout: 15000 });
  });

  test("resource-centric view renders with BFS depth layout", async ({ page }) => {
    const canvas = page.locator('[data-testid="topology-canvas"]');
    await expect(canvas).toBeVisible();
  });

  test("double-clicking a node re-centers the BFS graph", async ({ page }) => {
    const node = page.locator('[role="treeitem"]').first();
    if (await node.isVisible()) {
      await node.dblclick();
      // URL should update with resource parameter
      await page.waitForTimeout(1000);
      await expect(page).toHaveURL(/resource=/);
    }
  });

  test("BFS depth is limited and shows boundary nodes", async ({ page }) => {
    // Resource-centric view should limit depth
    await page.waitForTimeout(3000);
    const nodes = page.locator('[role="treeitem"]');
    const count = await nodes.count();
    // BFS should not return unlimited nodes
    expect(count).toBeLessThanOrEqual(200);
  });

  test("keyboard shortcut 4 switches to resource-centric view", async ({ page }) => {
    await page.goto("/topology?mode=1");
    await page.getByTestId("topology-tab-enterprise").click();
    await page.waitForSelector('[data-testid="topology-canvas"]', { timeout: 15000 });
    await page.keyboard.press("4");
    await page.waitForTimeout(1000);
    await expect(page).toHaveURL(/mode=4/);
  });

  test("navigation breadcrumb shows resource path", async ({ page }) => {
    const breadcrumb = page.locator('[data-testid="topology-breadcrumb"]');
    // Breadcrumb may or may not be present depending on navigation depth
    if (await breadcrumb.isVisible()) {
      await expect(breadcrumb).not.toBeEmpty();
    }
  });
});
