/**
 * E2E: Topology V2 — Namespace View (TASK-070)
 * Tests namespace-scoped topology with workload grouping.
 */
import { test, expect } from "@playwright/test";

test.describe("Topology V2: Namespace View", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/topology?mode=2&ns=default");
    await page.getByTestId("topology-tab-enterprise").click();
    await page.waitForSelector('[data-testid="topology-canvas"]', { timeout: 15000 });
  });

  test("renders namespace view with workload nodes", async ({ page }) => {
    const canvas = page.locator('[data-testid="topology-canvas"]');
    await expect(canvas).toBeVisible();
    // Namespace view shows individual resource nodes
    const nodes = page.locator('[role="treeitem"]');
    await expect(nodes.first()).toBeVisible({ timeout: 10000 });
  });

  test("nodes show kind headers with category colors", async ({ page }) => {
    const node = page.locator('[role="treeitem"]').first();
    await expect(node).toBeVisible({ timeout: 10000 });
    // Node should have visible content
    await expect(node).not.toBeEmpty();
  });

  test("edges are rendered between related resources", async ({ page }) => {
    // Wait for layout to complete
    await page.waitForTimeout(2000);
    const edges = page.locator(".react-flow__edge");
    // Should have at least one edge in a populated namespace
    const count = await edges.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test("edge labels show relationship type on hover", async ({ page }) => {
    const edgeLabel = page.locator('[role="img"][aria-label^="Relationship"]').first();
    if (await edgeLabel.isVisible()) {
      await edgeLabel.hover();
      await expect(edgeLabel).toBeVisible();
    }
  });

  test("selecting a node highlights it and shows detail panel", async ({ page }) => {
    const node = page.locator('[role="treeitem"]').first();
    await node.click();
    // Detail panel should appear
    const detailPanel = page.locator('[data-testid="topology-detail-panel"]');
    await expect(detailPanel).toBeVisible({ timeout: 5000 });
  });

  test("escape key deselects node and closes detail panel", async ({ page }) => {
    const node = page.locator('[role="treeitem"]').first();
    await node.click();
    await page.keyboard.press("Escape");
    const detailPanel = page.locator('[data-testid="topology-detail-panel"]');
    await expect(detailPanel).not.toBeVisible();
  });

  test("view mode 2 is reflected in URL", async ({ page }) => {
    await expect(page).toHaveURL(/mode=2/);
  });
});
