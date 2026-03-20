import { test, expect } from '@playwright/test';

test.describe('Security Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to security dashboard
    await page.goto('/security');
  });

  test('should display security dashboard page', async ({ page }) => {
    // Check page title
    await expect(page.locator('h1')).toContainText('Security Dashboard');

    // Check subtitle
    await expect(page.getByText('Comprehensive security monitoring and compliance')).toBeVisible();
  });

  test('should display security posture overview cards', async ({ page }) => {
    await page.waitForTimeout(1000);

    // Check for Security Score card
    await expect(page.getByText('Security Score')).toBeVisible();

    // Check for Vulnerabilities card
    await expect(page.getByText('Vulnerabilities')).toBeVisible();

    // Check for Security Issues card
    await expect(page.getByText('Security Issues')).toBeVisible();

    // Check for Compliance Score card
    await expect(page.getByText('Compliance Score')).toBeVisible();
  });

  test('should have refresh and export buttons', async ({ page }) => {
    // Check for Refresh button
    const refreshButton = page.getByRole('button', { name: /Refresh/i });
    await expect(refreshButton).toBeVisible();

    // Check for Export Report button
    const exportButton = page.getByRole('button', { name: /Export Report/i });
    await expect(exportButton).toBeVisible();
  });

  test('should display security grade (A-F)', async ({ page }) => {
    await page.waitForTimeout(1000);

    // Should display a grade from A to F
    const grade = page.locator('text=/^[A-F]$/').first();
    await expect(grade).toBeVisible();
  });

  test('should have tabs for different security aspects', async ({ page }) => {
    // Check for Overview tab
    await expect(page.getByRole('tab', { name: 'Overview' })).toBeVisible();

    // Check for Vulnerabilities tab
    await expect(page.getByRole('tab', { name: 'Vulnerabilities' })).toBeVisible();

    // Check for Security Issues tab
    await expect(page.getByRole('tab', { name: 'Security Issues' })).toBeVisible();

    // Check for Compliance tab
    await expect(page.getByRole('tab', { name: 'Compliance' })).toBeVisible();
  });

  test('should perform image vulnerability scan', async ({ page }) => {
    // Switch to Vulnerabilities tab
    await page.getByRole('tab', { name: 'Vulnerabilities' }).click();

    // Find image input field
    const imageInput = page.locator('input[placeholder*="image name"]');
    await expect(imageInput).toBeVisible();

    // Enter image name
    await imageInput.fill('nginx:1.19');

    // Click scan button
    const scanButton = page.getByRole('button', { name: /Scan Image/i });
    await scanButton.click();

    // Wait for scan to complete
    await page.waitForTimeout(2000);

    // Should show scan results
    await expect(page.getByText(/Vulnerability Scan Results/i)).toBeVisible();
  });

  test('should analyze pod security', async ({ page }) => {
    // Switch to Security Issues tab
    await page.getByRole('tab', { name: 'Security Issues' }).click();

    // Click analyze button
    const analyzeButton = page.getByRole('button', { name: /Analyze Example Pod/i });
    await analyzeButton.click();

    // Wait for analysis
    await page.waitForTimeout(1500);

    // Should show security analysis results
    await expect(page.getByText(/Security Analysis/i)).toBeVisible();
  });

  test('should run compliance check', async ({ page }) => {
    // Switch to Compliance tab
    await page.getByRole('tab', { name: 'Compliance' }).click();

    // Click compliance check button
    const checkButton = page.getByRole('button', { name: /Run Compliance Check/i });
    await checkButton.click();

    // Wait for check to complete
    await page.waitForTimeout(1500);

    // Should show compliance report
    await expect(page.getByText(/Compliance Report/i)).toBeVisible();
  });

  test('should display top security recommendations', async ({ page }) => {
    await page.waitForTimeout(1000);

    // Check for recommendations section
    await expect(page.getByText('Top Security Recommendations')).toBeVisible();

    // Should have at least one recommendation
    const recommendations = page.locator('text=/Implement|Enable|Scan|Review|Define/');
    await expect(recommendations.first()).toBeVisible();
  });

  test('should display vulnerability severity counts', async ({ page }) => {
    await page.waitForTimeout(1000);

    // Check for severity labels
    await expect(page.getByText('Critical').first()).toBeVisible();
    await expect(page.getByText('High').first()).toBeVisible();
    await expect(page.getByText('Medium').first()).toBeVisible();
    await expect(page.getByText('Low').first()).toBeVisible();
  });

  test('should refresh security posture', async ({ page }) => {
    await page.waitForTimeout(1000);

    // Click refresh button
    const refreshButton = page.getByRole('button', { name: /Refresh/i });
    await refreshButton.click();

    // Should show loading state briefly
    await page.waitForTimeout(500);

    // Data should reload
    await expect(page.getByText('Security Score')).toBeVisible();
  });

  test('should switch between tabs', async ({ page }) => {
    // Start on Overview
    await expect(page.getByRole('tab', { name: 'Overview' })).toHaveAttribute('data-state', 'active');

    // Switch to Vulnerabilities
    await page.getByRole('tab', { name: 'Vulnerabilities' }).click();
    await expect(page.getByText('Container Image Vulnerabilities')).toBeVisible();

    // Switch to Security Issues
    await page.getByRole('tab', { name: 'Security Issues' }).click();
    await expect(page.getByText('Pod Security Analysis')).toBeVisible();

    // Switch to Compliance
    await page.getByRole('tab', { name: 'Compliance' }).click();
    await expect(page.getByText('CIS Kubernetes Benchmark Compliance')).toBeVisible();
  });

  test('should display quick scan section in overview', async ({ page }) => {
    // Should be on Overview tab by default
    await expect(page.getByText('Quick Image Scan')).toBeVisible();

    // Should have input field
    const input = page.locator('input[placeholder*="image name"]').first();
    await expect(input).toBeVisible();
  });

  test('should display quick actions in overview', async ({ page }) => {
    // Check for Quick Actions section
    await expect(page.getByText('Quick Actions')).toBeVisible();

    // Should have demo buttons
    await expect(page.getByText('Analyze Pod Security (Demo)')).toBeVisible();
    await expect(page.getByText('Run Compliance Check (Demo)')).toBeVisible();
  });
});
