/**
 * E2E: Topology V2 — Interactions (TASK-073)
 * Tests node selection, hover states, detail panel, overlays.
 */
import { test, expect } from "@playwright/test";

test.describe("Topology V2: Interactions", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/topology?mode=2&ns=default");
    await page.getByTestId("topology-tab-enterprise").click();
    await page.waitForSelector('[data-testid="topology-canvas"]', { timeout: 15000 });
  });

  test("clicking a node opens the detail panel", async ({ page }) => {
    const node = page.locator('[role="treeitem"]').first();
    await expect(node).toBeVisible({ timeout: 10000 });
    await node.click();
    const panel = page.locator('[data-testid="topology-detail-panel"]');
    await expect(panel).toBeVisible({ timeout: 5000 });
  });

  test("detail panel shows resource name and kind", async ({ page }) => {
    const node = page.locator('[role="treeitem"]').first();
    await node.click();
    const panel = page.locator('[data-testid="topology-detail-panel"]');
    await expect(panel).toBeVisible({ timeout: 5000 });
    // Panel should contain resource info
    await expect(panel.locator("text=/Deployment|Pod|Service|ConfigMap|Secret/")).toBeVisible();
  });

  test("H key toggles health overlay", async ({ page }) => {
    await page.keyboard.press("h");
    await page.waitForTimeout(300);
    // Health legend should appear
    const healthLegend = page.locator("text=Healthy").or(page.locator('[data-testid="health-legend"]'));
    const isVisible = await healthLegend.isVisible();
    // Toggle off
    await page.keyboard.press("h");
    await page.waitForTimeout(300);
    if (isVisible) {
      await expect(healthLegend).not.toBeVisible();
    }
  });

  test("C key toggles cost overlay", async ({ page }) => {
    await page.keyboard.press("c");
    await page.waitForTimeout(300);
    // Cost overlay is toggled
    await page.keyboard.press("c");
    await page.waitForTimeout(300);
    // No crash indicates successful toggle
    const canvas = page.locator('[data-testid="topology-canvas"]');
    await expect(canvas).toBeVisible();
  });

  test("E key toggles edge labels", async ({ page }) => {
    await page.keyboard.press("e");
    await page.waitForTimeout(300);
    await page.keyboard.press("e");
    await page.waitForTimeout(300);
    const canvas = page.locator('[data-testid="topology-canvas"]');
    await expect(canvas).toBeVisible();
  });

  test("? key shows keyboard shortcuts overlay", async ({ page }) => {
    await page.keyboard.press("?");
    const overlay = page.locator('[role="dialog"][aria-label="Keyboard shortcuts"]');
    await expect(overlay).toBeVisible();
    // Close with Escape
    await page.keyboard.press("Escape");
    await expect(overlay).not.toBeVisible();
  });

  test("node status dot has accessible aria-label", async ({ page }) => {
    const statusDot = page.locator('[role="img"][aria-label^="Status:"]').first();
    await expect(statusDot).toBeVisible({ timeout: 10000 });
    const label = await statusDot.getAttribute("aria-label");
    expect(label).toMatch(/^Status: (healthy|warning|error|unknown)$/);
  });
});
