import { Page, expect, Locator } from '@playwright/test';
import { BasePage } from './BasePage';

export class ShellPanel extends BasePage {
    readonly terminal: Locator;
    readonly terminalInput: Locator;

    constructor(page: Page) {
        super(page);
        this.terminal = page.locator('.xterm-screen');
        this.terminalInput = page.locator('.xterm-helper-textarea');
    }

    async openShell() {
        await this.page.keyboard.press('`'); // Use shortcut if exists, or click UI
        // Fallback to UI click if shortcut fails
        if (!(await this.terminal.isVisible())) {
            await this.page.locator('[data-testid="shell-trigger"]').click();
        }
        await expect(this.terminal).toBeVisible();
    }

    async executeCommand(command: string) {
        await this.terminalInput.focus();
        await this.page.keyboard.type(command);
        await this.page.keyboard.press('Enter');
    }

    async getTerminalText() {
        // Note: Reading xterm.js via DOM is tricky, might need to evaluate in page
        return await this.page.evaluate(() => {
            const xterm = (window as any).term;
            if (xterm) {
                return xterm.buffer.active.getLine(xterm.buffer.active.cursorY)?.translateToString();
            }
            return '';
        });
    }

    async waitForOutput(text: string) {
        await expect(this.terminal).toContainText(text, { timeout: 10000 });
    }
}
