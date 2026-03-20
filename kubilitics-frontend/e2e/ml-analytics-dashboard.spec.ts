import { test, expect } from '@playwright/test';

test.describe('ML Analytics Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to ML analytics dashboard
    await page.goto('/ml-analytics');
  });

  test('should display ML analytics dashboard page', async ({ page }) => {
    // Check page title
    await expect(page.locator('h1')).toContainText('ML Analytics Dashboard');

    // Check subtitle
    await expect(page.getByText('Machine learning-powered anomaly detection and forecasting')).toBeVisible();
  });

  test('should display key metrics cards', async ({ page }) => {
    await page.waitForTimeout(1000);

    // Check for Anomalies card
    await expect(page.getByText('Anomalies (24h)')).toBeVisible();

    // Check for Model Accuracy card
    await expect(page.getByText('Model Accuracy')).toBeVisible();

    // Check for Forecast Confidence card
    await expect(page.getByText('Forecast Confidence')).toBeVisible();

    // Check for Training Data card
    await expect(page.getByText('Training Data')).toBeVisible();
  });

  test('should have detect anomalies and export buttons', async ({ page }) => {
    // Check for Detect Anomalies button
    const detectButton = page.getByRole('button', { name: /Detect Anomalies/i });
    await expect(detectButton).toBeVisible();

    // Check for Export Data button
    const exportButton = page.getByRole('button', { name: /Export Data/i });
    await expect(exportButton).toBeVisible();
  });

  test('should display metric selector', async ({ page }) => {
    // Check for Select Metric section
    await expect(page.getByText('Select Metric')).toBeVisible();

    // Check for metric buttons
    await expect(page.getByRole('button', { name: 'CPU Usage' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Memory Usage' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Network I/O' })).toBeVisible();
  });

  test('should switch between metrics', async ({ page }) => {
    // Click Memory Usage
    await page.getByRole('button', { name: 'Memory Usage' }).click();
    await page.waitForTimeout(500);

    // Click Network I/O
    await page.getByRole('button', { name: 'Network I/O' }).click();
    await page.waitForTimeout(500);

    // Click CPU Usage (back to default)
    await page.getByRole('button', { name: 'CPU Usage' }).click();
    await page.waitForTimeout(500);
  });

  test('should have tabs for different ML views', async ({ page }) => {
    // Check for Overview tab
    await expect(page.getByRole('tab', { name: 'Overview' })).toBeVisible();

    // Check for Anomalies tab
    await expect(page.getByRole('tab', { name: 'Anomaly Detection' })).toBeVisible();

    // Check for Forecasts tab
    await expect(page.getByRole('tab', { name: 'Forecasts' })).toBeVisible();

    // Check for Models tab
    await expect(page.getByRole('tab', { name: 'Model Info' })).toBeVisible();
  });

  test('should detect anomalies', async ({ page }) => {
    // Click detect anomalies button
    const detectButton = page.getByRole('button', { name: /Detect Anomalies/i });
    await detectButton.click();

    // Wait for detection
    await page.waitForTimeout(2000);

    // Should show anomaly count
    const anomalyCount = page.locator('text=/\\d+/').first();
    await expect(anomalyCount).toBeVisible();
  });

  test('should generate forecast', async ({ page }) => {
    // Look for Generate Forecast button in overview
    const forecastButton = page.getByRole('button', { name: /Generate Forecast/i }).first();
    await forecastButton.click();

    // Wait for forecast generation
    await page.waitForTimeout(2000);

    // Should show forecast chart or results
    await expect(page.getByText(/Forecast/i)).toBeVisible();
  });

  test('should display anomaly detection chart', async ({ page }) => {
    // Switch to Anomalies tab
    await page.getByRole('tab', { name: 'Anomaly Detection' }).click();

    // Check for Anomaly Detection Analysis section
    await expect(page.getByText('Anomaly Detection Analysis')).toBeVisible();

    // Check for description
    await expect(page.getByText('Using Isolation Forest algorithm')).toBeVisible();
  });

  test('should display forecasting chart', async ({ page }) => {
    // Switch to Forecasts tab
    await page.getByRole('tab', { name: 'Forecasts' }).click();

    // Check for Time Series Forecasting section
    await expect(page.getByText('Time Series Forecasting')).toBeVisible();

    // Check for ARIMA description
    await expect(page.getByText('ARIMA model predicts future resource usage')).toBeVisible();
  });

  test('should display model information', async ({ page }) => {
    // Switch to Model Info tab
    await page.getByRole('tab', { name: 'Model Info' }).click();

    // Should show model explainability panels
    await page.waitForTimeout(1000);

    // Check for algorithm mentions
    const algorithmText = page.locator('text=/Isolation Forest|ARIMA/');
    await expect(algorithmText.first()).toBeVisible();
  });

  test('should display recent anomalies after detection', async ({ page }) => {
    // Detect anomalies first
    await page.getByRole('button', { name: /Detect Anomalies/i }).click();
    await page.waitForTimeout(2000);

    // Should show Recent Anomalies section
    await expect(page.getByText('Recent Anomalies')).toBeVisible();
  });

  test('should display anomaly severity badges', async ({ page }) => {
    // Detect anomalies
    await page.getByRole('button', { name: /Detect Anomalies/i }).click();
    await page.waitForTimeout(2000);

    // Should display severity badges
    const severityBadges = page.locator('text=/critical|high|medium|low/i');
    await expect(severityBadges.first()).toBeVisible();
  });

  test('should display model algorithm names', async ({ page }) => {
    await page.waitForTimeout(1000);

    // Should show Isolation Forest
    await expect(page.getByText('Isolation Forest Algorithm')).toBeVisible();

    // Should show ARIMA Model
    await expect(page.getByText('ARIMA Model')).toBeVisible();
  });

  test('should show data point count', async ({ page }) => {
    await page.waitForTimeout(1000);

    // Training Data card should show count
    const dataCount = page.getByText('Training Data').locator('../..').locator('text=/\\d+/').first();
    await expect(dataCount).toBeVisible();
  });

  test('should switch between all tabs', async ({ page }) => {
    // Overview (default)
    await expect(page.getByRole('tab', { name: 'Overview' })).toHaveAttribute('data-state', 'active');

    // Switch to Anomalies
    await page.getByRole('tab', { name: 'Anomaly Detection' }).click();
    await expect(page.getByText('Anomaly Detection Analysis')).toBeVisible();

    // Switch to Forecasts
    await page.getByRole('tab', { name: 'Forecasts' }).click();
    await expect(page.getByText('Time Series Forecasting')).toBeVisible();

    // Switch to Models
    await page.getByRole('tab', { name: 'Model Info' }).click();
    await page.waitForTimeout(500);

    // Back to Overview
    await page.getByRole('tab', { name: 'Overview' }).click();
    await expect(page.getByText('Real-time Anomaly Detection')).toBeVisible();
  });
});
