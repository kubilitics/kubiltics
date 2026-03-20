/**
 * E2E: Topology V2 — Visual Regression (TASK-077)
 * Captures baseline screenshots for visual regression testing.
 * Run with: npx playwright test topology-v2-visual-regression --update-snapshots
 */
import { test, expect } from "@playwright/test";

test.describe("Topology V2: Visual Regression Baselines", () => {
  test("cluster view baseline", async ({ page }) => {
    await page.goto("/topology?mode=1");
    await page.getByTestId("topology-tab-enterprise").click();
    await page.waitForSelector('[data-testid="topology-canvas"]', { timeout: 15000 });
    await page.waitForTimeout(3000); // Wait for layout stabilization
    await expect(page.locator('[data-testid="topology-canvas"]')).toHaveScreenshot("cluster-view.png", {
      maxDiffPixelRatio: 0.02,
    });
  });

  test("namespace view baseline", async ({ page }) => {
    await page.goto("/topology?mode=2&ns=default");
    await page.getByTestId("topology-tab-enterprise").click();
    await page.waitForSelector('[data-testid="topology-canvas"]', { timeout: 15000 });
    await page.waitForTimeout(3000);
    await expect(page.locator('[data-testid="topology-canvas"]')).toHaveScreenshot("namespace-view.png", {
      maxDiffPixelRatio: 0.02,
    });
  });

  test("workload view baseline", async ({ page }) => {
    await page.goto("/topology?mode=3&ns=default");
    await page.getByTestId("topology-tab-enterprise").click();
    await page.waitForSelector('[data-testid="topology-canvas"]', { timeout: 15000 });
    await page.waitForTimeout(3000);
    await expect(page.locator('[data-testid="topology-canvas"]')).toHaveScreenshot("workload-view.png", {
      maxDiffPixelRatio: 0.02,
    });
  });

  test("resource-centric view baseline", async ({ page }) => {
    await page.goto("/topology?mode=4");
    await page.getByTestId("topology-tab-enterprise").click();
    await page.waitForSelector('[data-testid="topology-canvas"]', { timeout: 15000 });
    await page.waitForTimeout(3000);
    await expect(page.locator('[data-testid="topology-canvas"]')).toHaveScreenshot("resource-centric-view.png", {
      maxDiffPixelRatio: 0.02,
    });
  });

  test("RBAC view baseline", async ({ page }) => {
    await page.goto("/topology?mode=5");
    await page.getByTestId("topology-tab-enterprise").click();
    await page.waitForSelector('[data-testid="topology-canvas"]', { timeout: 15000 });
    await page.waitForTimeout(3000);
    await expect(page.locator('[data-testid="topology-canvas"]')).toHaveScreenshot("rbac-view.png", {
      maxDiffPixelRatio: 0.02,
    });
  });

  test("health overlay baseline", async ({ page }) => {
    await page.goto("/topology?mode=2&ns=default");
    await page.getByTestId("topology-tab-enterprise").click();
    await page.waitForSelector('[data-testid="topology-canvas"]', { timeout: 15000 });
    await page.waitForTimeout(2000);
    await page.keyboard.press("h");
    await page.waitForTimeout(1000);
    await expect(page.locator('[data-testid="topology-canvas"]')).toHaveScreenshot("health-overlay.png", {
      maxDiffPixelRatio: 0.02,
    });
  });

  test("dark mode baseline", async ({ page }) => {
    await page.goto("/topology?mode=2&ns=default");
    await page.getByTestId("topology-tab-enterprise").click();
    await page.waitForSelector('[data-testid="topology-canvas"]', { timeout: 15000 });
    // Toggle dark mode if available
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    await page.waitForTimeout(2000);
    await expect(page.locator('[data-testid="topology-canvas"]')).toHaveScreenshot("dark-mode.png", {
      maxDiffPixelRatio: 0.02,
    });
  });

  test("keyboard shortcuts overlay baseline", async ({ page }) => {
    await page.goto("/topology?mode=2&ns=default");
    await page.getByTestId("topology-tab-enterprise").click();
    await page.waitForSelector('[data-testid="topology-canvas"]', { timeout: 15000 });
    await page.keyboard.press("?");
    await page.waitForTimeout(500);
    await expect(page.locator('[role="dialog"]')).toHaveScreenshot("shortcuts-overlay.png", {
      maxDiffPixelRatio: 0.02,
    });
  });
});
