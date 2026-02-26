import { test, expect } from '@playwright/test';

test.describe('Analytics Overview Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to analytics overview
    await page.goto('/analytics');
  });

  test('should display analytics overview page', async ({ page }) => {
    // Check page title
    await expect(page.locator('h1')).toContainText('Analytics Overview');

    // Check subtitle
    await expect(page.getByText('Unified insights from Security, ML Analytics, and Cost Intelligence')).toBeVisible();
  });

  test('should display system health cards', async ({ page }) => {
    // Check for Security card
    const securityCard = page.locator('text=Security').first();
    await expect(securityCard).toBeVisible();

    // Check for ML Analytics card
    const mlCard = page.locator('text=ML Analytics').first();
    await expect(mlCard).toBeVisible();

    // Check for Compliance card
    const complianceCard = page.locator('text=Compliance').first();
    await expect(complianceCard).toBeVisible();
  });

  test('should display security score and grade', async ({ page }) => {
    // Wait for data to load
    await page.waitForTimeout(1000);

    // Check for security score (should be a number)
    const scoreElement = page.locator('text=Security').locator('../..').locator('text=/\\d+/').first();
    await expect(scoreElement).toBeVisible();

    // Check for grade (A-F)
    const gradeElement = page.locator('text=Security').locator('../..').locator('text=/[A-F]/').first();
    await expect(gradeElement).toBeVisible();
  });

  test('should display key insights section', async ({ page }) => {
    // Check for insights heading
    await expect(page.getByText('Key Insights & Recommendations')).toBeVisible();

    // Check for AI-powered insights description
    await expect(page.getByText('AI-powered insights combining security, performance, and cost data')).toBeVisible();

    // Should have at least one insight
    await page.waitForTimeout(500);
    const insights = page.locator('[class*="border rounded-lg p-4"]');
    await expect(insights.first()).toBeVisible();
  });

  test('should navigate to security dashboard', async ({ page }) => {
    // Click on Security card
    await page.locator('text=Security').first().click();

    // Should navigate to security dashboard
    await expect(page).toHaveURL(/.*\/security/);
    await expect(page.locator('h1')).toContainText('Security Dashboard');
  });

  test('should navigate to ML analytics dashboard', async ({ page }) => {
    // Click on ML Analytics card
    await page.locator('text=ML Analytics').first().click();

    // Should navigate to ML analytics
    await expect(page).toHaveURL(/.*\/ml-analytics/);
    await expect(page.locator('h1')).toContainText('ML Analytics Dashboard');
  });

  test('should display quick action cards', async ({ page }) => {
    // Scroll to quick actions section
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

    // Check for quick action cards
    await expect(page.getByText('Go to Security')).toBeVisible();
    await expect(page.getByText('Go to ML Analytics')).toBeVisible();
  });

  test('should display system status', async ({ page }) => {
    // Scroll to bottom
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

    // Check for system status section
    await expect(page.getByText('System Status')).toBeVisible();

    // Check for status indicators
    await expect(page.getByText('API Status')).toBeVisible();
    await expect(page.getByText('ML Models')).toBeVisible();
    await expect(page.getByText('Data Collection')).toBeVisible();
  });

  test('should show priority badges on insights', async ({ page }) => {
    await page.waitForTimeout(500);

    // Check for priority badges (CRITICAL, HIGH, MEDIUM, LOW)
    const badges = page.locator('text=/CRITICAL|HIGH|MEDIUM|LOW/');
    await expect(badges.first()).toBeVisible();
  });

  test('should display anomaly count', async ({ page }) => {
    // Find ML Analytics card and check for anomaly count
    const mlCard = page.locator('text=ML Analytics').locator('../..');
    const anomalyCount = mlCard.locator('text=/\\d+/').first();
    await expect(anomalyCount).toBeVisible();
  });

  test('should display compliance score percentage', async ({ page }) => {
    // Find Compliance card and check for percentage
    const complianceCard = page.locator('text=Compliance').locator('../..');
    const percentage = complianceCard.locator('text=/\\d+\\.\\d+%/').first();
    await expect(percentage).toBeVisible();
  });
});
