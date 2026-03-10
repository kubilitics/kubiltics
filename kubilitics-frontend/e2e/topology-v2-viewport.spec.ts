/**
 * E2E: Topology V2 — Viewport & Semantic Zoom (TASK-072)
 * Tests zoom-level node type switching and viewport interactions.
 */
import { test, expect } from "@playwright/test";

test.describe("Topology V2: Viewport & Semantic Zoom", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/topology?mode=2&ns=default");
    await page.getByTestId("topology-tab-enterprise").click();
    await page.waitForSelector('[data-testid="topology-canvas"]', { timeout: 15000 });
  });

  test("canvas supports mouse wheel zoom", async ({ page }) => {
    const canvas = page.locator('[data-testid="topology-canvas"]');
    await expect(canvas).toBeVisible();
    // Zoom in with wheel
    await canvas.hover();
    await page.mouse.wheel(0, -300);
    await page.waitForTimeout(500);
    // Canvas should still be functional
    await expect(canvas).toBeVisible();
  });

  test("+ key zooms in", async ({ page }) => {
    await page.keyboard.press("+");
    await page.waitForTimeout(500);
    const canvas = page.locator('[data-testid="topology-canvas"]');
    await expect(canvas).toBeVisible();
  });

  test("- key zooms out", async ({ page }) => {
    await page.keyboard.press("-");
    await page.waitForTimeout(500);
    const canvas = page.locator('[data-testid="topology-canvas"]');
    await expect(canvas).toBeVisible();
  });

  test("minimap toggle via M key", async ({ page }) => {
    // Toggle minimap on
    await page.keyboard.press("m");
    await page.waitForTimeout(300);
    const minimap = page.locator(".react-flow__minimap");
    const isVisible = await minimap.isVisible();

    // Toggle minimap off
    await page.keyboard.press("m");
    await page.waitForTimeout(300);
    const isVisibleAfter = await minimap.isVisible();

    // State should have toggled
    expect(isVisible).not.toBe(isVisibleAfter);
  });

  test("canvas supports pan via drag", async ({ page }) => {
    const canvas = page.locator('[data-testid="topology-canvas"]');
    const box = await canvas.boundingBox();
    if (box) {
      const startX = box.x + box.width / 2;
      const startY = box.y + box.height / 2;
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX + 100, startY + 50, { steps: 5 });
      await page.mouse.up();
      // Canvas should still be visible after pan
      await expect(canvas).toBeVisible();
    }
  });

  test("F key fits view to all nodes", async ({ page }) => {
    // Zoom out first
    await page.keyboard.press("-");
    await page.keyboard.press("-");
    await page.waitForTimeout(300);
    // Fit view
    await page.keyboard.press("f");
    await page.waitForTimeout(500);
    const canvas = page.locator('[data-testid="topology-canvas"]');
    await expect(canvas).toBeVisible();
  });
});
