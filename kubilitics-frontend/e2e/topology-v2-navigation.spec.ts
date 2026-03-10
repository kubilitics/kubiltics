/**
 * E2E: Topology V2 — Navigation & Deep Links (TASK-075)
 * Tests URL-based navigation, deep linking, and breadcrumbs.
 */
import { test, expect } from "@playwright/test";

test.describe("Topology V2: Navigation & Deep Links", () => {
  test("deep link to namespace view loads correctly", async ({ page }) => {
    await page.goto("/topology?mode=2&ns=kube-system");
    await page.getByTestId("topology-tab-enterprise").click();
    await page.waitForSelector('[data-testid="topology-canvas"]', { timeout: 15000 });
    const canvas = page.locator('[data-testid="topology-canvas"]');
    await expect(canvas).toBeVisible();
  });

  test("deep link to cluster view loads correctly", async ({ page }) => {
    await page.goto("/topology?mode=1");
    await page.getByTestId("topology-tab-enterprise").click();
    await page.waitForSelector('[data-testid="topology-canvas"]', { timeout: 15000 });
    const canvas = page.locator('[data-testid="topology-canvas"]');
    await expect(canvas).toBeVisible();
  });

  test("switching view mode updates URL", async ({ page }) => {
    await page.goto("/topology");
    await page.getByTestId("topology-tab-enterprise").click();
    await page.waitForSelector('[data-testid="topology-canvas"]', { timeout: 15000 });
    // Press 2 for namespace view
    await page.keyboard.press("2");
    await page.waitForTimeout(500);
    await expect(page).toHaveURL(/mode=2/);
    // Press 3 for workload view
    await page.keyboard.press("3");
    await page.waitForTimeout(500);
    await expect(page).toHaveURL(/mode=3/);
  });

  test("Backspace navigates back in topology history", async ({ page }) => {
    await page.goto("/topology?mode=1");
    await page.getByTestId("topology-tab-enterprise").click();
    await page.waitForSelector('[data-testid="topology-canvas"]', { timeout: 15000 });
    // Navigate to namespace view
    await page.keyboard.press("2");
    await page.waitForTimeout(500);
    // Navigate back
    await page.keyboard.press("Backspace");
    await page.waitForTimeout(500);
    await expect(page).toHaveURL(/mode=1/);
  });

  test("direct URL with resource parameter loads resource-centric view", async ({ page }) => {
    await page.goto("/topology?mode=4&resource=deployment/nginx");
    await page.getByTestId("topology-tab-enterprise").click();
    await page.waitForSelector('[data-testid="topology-canvas"]', { timeout: 15000 });
    const canvas = page.locator('[data-testid="topology-canvas"]');
    await expect(canvas).toBeVisible();
  });

  test("browser back button works with topology navigation", async ({ page }) => {
    await page.goto("/topology?mode=1");
    await page.getByTestId("topology-tab-enterprise").click();
    await page.waitForSelector('[data-testid="topology-canvas"]', { timeout: 15000 });
    await page.keyboard.press("2");
    await page.waitForTimeout(500);
    await page.goBack();
    await page.waitForTimeout(500);
    await expect(page).toHaveURL(/mode=1/);
  });
});
