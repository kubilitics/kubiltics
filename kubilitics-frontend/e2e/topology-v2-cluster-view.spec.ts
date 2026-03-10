/**
 * E2E: Topology V2 — Cluster View (TASK-069)
 * Tests the cluster-level summary view with namespace grouping.
 */
import { test, expect } from "@playwright/test";

test.describe("Topology V2: Cluster View", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/topology");
    await page.getByTestId("topology-tab-enterprise").click();
    await page.waitForSelector('[data-testid="topology-canvas"]', { timeout: 15000 });
  });

  test("renders cluster view by default with namespace summary nodes", async ({ page }) => {
    const canvas = page.locator('[data-testid="topology-canvas"]');
    await expect(canvas).toBeVisible();
    // Cluster view shows summary nodes for each namespace
    const summaryNodes = page.locator('[role="group"]');
    await expect(summaryNodes.first()).toBeVisible({ timeout: 10000 });
  });

  test("displays toolbar with view mode selector", async ({ page }) => {
    const toolbar = page.locator('[data-testid="topology-toolbar"]');
    await expect(toolbar).toBeVisible();
    // View mode selector should be present
    const viewSelector = page.locator('[data-testid="view-mode-select"]');
    await expect(viewSelector).toBeVisible();
  });

  test("namespace summary node shows resource counts", async ({ page }) => {
    const summaryNode = page.locator('[role="group"]').first();
    await expect(summaryNode).toBeVisible({ timeout: 10000 });
    // Summary nodes display aggregated counts
    const countText = summaryNode.locator("text=resources");
    await expect(countText.or(summaryNode.locator("text=pods"))).toBeVisible();
  });

  test("clicking a summary node navigates to namespace view", async ({ page }) => {
    const summaryNode = page.locator('[role="group"]').first();
    await summaryNode.click();
    // URL should update with namespace filter
    await expect(page).toHaveURL(/[?&]ns=/);
  });

  test("toolbar search input is accessible via / shortcut", async ({ page }) => {
    await page.keyboard.press("/");
    const searchInput = page.locator('[data-topology-search]');
    await expect(searchInput).toBeFocused();
  });

  test("fit-to-screen shortcut works", async ({ page }) => {
    // Press F to trigger fit-to-screen
    await page.keyboard.press("f");
    // Canvas should still be visible (no error state)
    const canvas = page.locator('[data-testid="topology-canvas"]');
    await expect(canvas).toBeVisible();
  });
});
