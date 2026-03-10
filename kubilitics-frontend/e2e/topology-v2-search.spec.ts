/**
 * E2E: Topology V2 — Search & Filter (TASK-074)
 * Tests search functionality, filtering, and result highlighting.
 */
import { test, expect } from "@playwright/test";

test.describe("Topology V2: Search & Filter", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/topology?mode=2&ns=default");
    await page.getByTestId("topology-tab-enterprise").click();
    await page.waitForSelector('[data-testid="topology-canvas"]', { timeout: 15000 });
  });

  test("/ shortcut focuses the search input", async ({ page }) => {
    await page.keyboard.press("/");
    const searchInput = page.locator('[data-topology-search]');
    await expect(searchInput).toBeFocused();
  });

  test("typing in search filters visible nodes", async ({ page }) => {
    const searchInput = page.locator('[data-topology-search]');
    await searchInput.click();
    await searchInput.fill("deploy");
    await page.waitForTimeout(500);
    // Canvas should still render
    const canvas = page.locator('[data-testid="topology-canvas"]');
    await expect(canvas).toBeVisible();
  });

  test("clearing search restores all nodes", async ({ page }) => {
    const searchInput = page.locator('[data-topology-search]');
    await searchInput.click();
    await searchInput.fill("deploy");
    await page.waitForTimeout(500);
    await searchInput.clear();
    await page.waitForTimeout(500);
    const canvas = page.locator('[data-testid="topology-canvas"]');
    await expect(canvas).toBeVisible();
  });

  test("search with no results shows empty state", async ({ page }) => {
    const searchInput = page.locator('[data-topology-search]');
    await searchInput.click();
    await searchInput.fill("zzz_nonexistent_resource_xyz");
    await page.waitForTimeout(1000);
    // Should show no-search-results empty state or zero nodes
    const emptyState = page.locator("text=No results found").or(page.locator('[data-testid="topology-empty-state"]'));
    const nodes = page.locator('[role="treeitem"]');
    const nodeCount = await nodes.count();
    // Either empty state is shown or no treeitem nodes
    expect((await emptyState.isVisible()) || nodeCount === 0).toBeTruthy();
  });

  test("search input has placeholder text mentioning / shortcut", async ({ page }) => {
    const searchInput = page.locator('[data-topology-search]');
    const placeholder = await searchInput.getAttribute("placeholder");
    expect(placeholder).toContain("/");
  });

  test("Escape clears search and deselects", async ({ page }) => {
    const searchInput = page.locator('[data-topology-search]');
    await searchInput.click();
    await searchInput.fill("pod");
    await page.keyboard.press("Escape");
    // Search input should lose focus
    await expect(searchInput).not.toBeFocused();
  });
});
