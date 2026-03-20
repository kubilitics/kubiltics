import { test, expect } from '@playwright/test';

/**
 * Shell / kcli UX: detail view scroll and basic interaction.
 * - Verifies shell panel opens with kcli UI and stays usable.
 * - Enter key opens detail (when list is focused); scroll keys (j/k, pgup/pgdown) are
 *   implemented in kcli TUI (see project-docs/frontend-ux-issues-list.md).
 * Full assertion of "scroll hint visible in terminal" requires live backend or mock
 * that echoes kcli TUI output; this spec focuses on panel visibility and key handling.
 * Run with --project=chromium for stable runs (Shell button can be covered on small viewports).
 */
test.describe('shell kcli detail UX', () => {
  test.beforeEach(async ({ page }) => {
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
            activeNamespace: 'default',
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
  });

  test('opens shell with kcli UI and panel remains usable', async ({ page }) => {
    await page.goto('/pods');

    const shellButton = page.getByRole('button', { name: /Shell/i }).first();
    await expect(shellButton).toBeVisible({ timeout: 15000 });
    await shellButton.scrollIntoViewIfNeeded();
    await shellButton.click();

    await expect(page.getByText(/kcli (UI|Shell)/i).first()).toBeVisible();
    const kcliUiModeBtn = page.getByRole('button', { name: /Use kcli UI mode/i });
    await expect(kcliUiModeBtn).toBeVisible();
    await kcliUiModeBtn.click();
    await expect(page.getByText(/kcli UI/i).first()).toBeVisible();

    const terminalInput = page.locator('.xterm-helper-textarea');
    await terminalInput.focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    await expect(page.getByText(/kcli UI/i).first()).toBeVisible();
    const closeBtn = page.getByRole('button', { name: /Close shell/i });
    await expect(closeBtn).toBeVisible();
    await expect(closeBtn).toBeEnabled();
  });

  test('kcli engine and UI/Shell mode toggles work from pods list', async ({ page }) => {
    await page.goto('/pods');

    const shellButton = page.getByRole('button', { name: /Shell/i }).first();
    await expect(shellButton).toBeVisible({ timeout: 15000 });
    await shellButton.scrollIntoViewIfNeeded();
    await shellButton.click();

    await expect(page.getByRole('button', { name: /Use kubectl engine/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Use kcli engine/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Use kcli UI mode/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Use kcli shell mode/i })).toBeVisible();
  });
});
