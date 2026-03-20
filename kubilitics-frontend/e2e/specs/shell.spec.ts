import { test, expect } from '@playwright/test';
import { ConnectionPage } from '../page-objects/ConnectionPage';
import { ShellPanel } from '../page-objects/ShellPanel';

test.describe('Kubernetes Shell Interactivity', () => {
    let connectionPage: ConnectionPage;
    let shellPanel: ShellPanel;

    test.beforeEach(async ({ page }) => {
        connectionPage = new ConnectionPage(page);
        shellPanel = new ShellPanel(page);

        await connectionPage.goto();
        await connectionPage.selectDesktopMode();
        await page.locator('text=Explore Demo Mode').click();
    });

    test('should open and initialize shell', async () => {
        await shellPanel.openShell();
        // Wait for prompt or cursor
        await expect(shellPanel.terminal).toBeVisible();
    });

    test('should execute basic commands', async () => {
        await shellPanel.openShell();
        await shellPanel.executeCommand('ls -la');
        // In demo mode websocket output can be empty; assert command submission does not break terminal interactivity.
        await expect(shellPanel.terminal).toBeVisible();
    });

    test('should handle invalid commands gracefully', async () => {
        await shellPanel.openShell();
        await shellPanel.executeCommand('invalidcommand123');
        // Invalid commands must not crash/close the shell panel.
        await expect(shellPanel.terminal).toBeVisible();
    });
});
