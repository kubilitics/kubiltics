import { test, expect } from '@playwright/test';

test.describe('Cost route (removed)', () => {
  test('visiting /cost should not show Cost Intelligence Dashboard', async ({ page }) => {
    await page.goto('/cost');
    // Cost dashboard was removed; /cost may redirect or show another view.
    // Ensure we do not see the old cost dashboard title.
    await expect(page.locator('h1')).not.toContainText('Cost Intelligence Dashboard');
  });
});
