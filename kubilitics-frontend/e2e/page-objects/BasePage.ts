import { Page, expect, Locator } from '@playwright/test';

export class BasePage {
    readonly page: Page;
    readonly searchButton: Locator;
    readonly navHome: Locator;
    readonly navTopology: Locator;
    readonly navResources: Locator;
    readonly navSettings: Locator;

    constructor(page: Page) {
        this.page = page;
        this.searchButton = page.locator('[data-testid="search-trigger"]');
        this.navHome = page.locator('nav').getByRole('link', { name: 'Home' });
        this.navTopology = page.locator('nav').getByRole('link', { name: 'Topology' });
        this.navResources = page.locator('nav').getByRole('link', { name: 'Resources' });
        this.navSettings = page.locator('nav').getByRole('link', { name: 'Settings' });
    }

    async waitForNetworkIdle() {
        // Use 'load' instead of 'networkidle' for better reliability with persistent websockets.
        await this.page.waitForLoadState('load');
        // Small buffer for hydration
        await this.page.waitForTimeout(500);
    }

    async captureConsoleLogs() {
        this.page.on('console', msg => {
            if (msg.type() === 'error') {
                console.error(`PAGE ERROR: ${msg.text()}`);
            }
        });
    }

    async openSearch() {
        await this.page.keyboard.press('Meta+K');
        await expect(this.page.locator('[data-testid="search-dialog"]')).toBeVisible();
    }
}
