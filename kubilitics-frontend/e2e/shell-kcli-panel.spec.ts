import { test, expect } from '@playwright/test';

test('shell panel supports kcli and kubectl engine switching with persisted preference', async ({ page }) => {
  await page.addInitScript(() => {
    const activeCluster = {
      id: 'prod-us-east',
      name: 'production-us-east',
      context: 'prod-us-east-1',
      version: 'v1.28.4',
      status: 'healthy',
      region: 'us-east-1',
      provider: 'eks',
      nodes: 12,
      namespaces: 24,
      pods: { running: 156, pending: 3, failed: 1 },
      cpu: { used: 68, total: 100 },
      memory: { used: 72, total: 100 },
    };
    localStorage.setItem(
      'kubilitics-cluster',
      JSON.stringify({
        state: {
          clusters: [activeCluster],
          activeCluster,
          activeNamespace: 'all',
          namespaces: [],
          isDemo: true,
          appMode: 'desktop',
          isOnboarded: true,
        },
        version: 0,
      })
    );
    localStorage.setItem(
      'kubilitics-backend-config',
      JSON.stringify({
        state: {
          backendBaseUrl: '',
          currentClusterId: 'prod-us-east',
        },
        version: 0,
      })
    );
  });

  await page.goto('/pods');

  const shellButton = page.getByRole('button', { name: /Shell/i }).first();
  await expect(shellButton).toBeVisible({ timeout: 15000 });
  await expect(shellButton).toBeEnabled();

  await shellButton.click();

  // Default should prefer kcli engine.
  await expect(page.getByText(/kcli (UI|Shell)/i).first()).toBeVisible();

  const kubectlEngineBtn = page.getByRole('button', { name: /Use kubectl engine/i });
  const kcliEngineBtn = page.getByRole('button', { name: /Use kcli engine/i });
  await expect(kubectlEngineBtn).toBeVisible();
  await expect(kcliEngineBtn).toBeVisible();

  // Switch to kubectl engine.
  await kubectlEngineBtn.click();
  await expect(page.getByText(/Kubectl Shell/i).first()).toBeVisible();

  // Switch back to kcli, then toggle submode.
  await kcliEngineBtn.click();
  await expect(page.getByText(/kcli (UI|Shell)/i).first()).toBeVisible();

  const kcliShellModeBtn = page.getByRole('button', { name: /Use kcli shell mode/i });
  const kcliUiModeBtn = page.getByRole('button', { name: /Use kcli UI mode/i });

  await expect(kcliShellModeBtn).toBeVisible();
  await expect(kcliUiModeBtn).toBeVisible();

  await kcliShellModeBtn.click();
  await expect(page.getByText(/kcli Shell/i).first()).toBeVisible();

  // Trigger reconnect action.
  await page.getByRole('button', { name: /Reconnect session/i }).click();

  // Close and reopen; preference should persist in localStorage.
  await page.getByRole('button', { name: /Close shell/i }).click();
  await shellButton.click();
  await expect(page.getByText(/kcli Shell/i).first()).toBeVisible();

  // Switch to UI mode and verify.
  await kcliUiModeBtn.click();
  await expect(page.getByText(/kcli UI/i).first()).toBeVisible();
});
