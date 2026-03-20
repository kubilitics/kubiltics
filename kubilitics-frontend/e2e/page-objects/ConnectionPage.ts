import { Page, expect, Locator } from '@playwright/test';
import { BasePage } from './BasePage';

export class ConnectionPage extends BasePage {
    readonly desktopEngineCard: Locator;
    readonly inClusterCard: Locator;
    readonly uploadTab: Locator;
    readonly autoDetectTab: Locator;
    readonly connectButton: Locator;
    readonly fileInput: Locator;

    constructor(page: Page) {
        super(page);
        this.desktopEngineCard = page.locator('div:has-text("Desktop Engine")').nth(1); // Target the card
        this.inClusterCard = page.locator('div:has-text("In-Cluster OS")').nth(1);
        this.uploadTab = page.locator('button:has-text("Upload Config")');
        this.autoDetectTab = page.locator('button:has-text("Auto-Detect")');
        this.connectButton = page.getByRole('button', { name: /Connect|Initialize/ });
        this.fileInput = page.locator('input[type="file"]');
    }

    async goto() {
        await this.page.goto('/');
    }

    async selectDesktopMode() {
        await this.page.locator('h3:has-text("Desktop Engine")').click();
        await this.page.waitForURL(/\/connect/, { timeout: 10000 });
    }

    async selectInClusterMode() {
        await this.page.locator('h3:has-text("In-Cluster OS")').click();
        await this.page.waitForURL(/\/connect/, { timeout: 10000 });
    }

    async uploadKubeconfig(filePath: string) {
        await this.uploadTab.click();
        const fileChooserPromise = this.page.waitForEvent('filechooser');
        await this.page.locator('text=Select File').click();
        const fileChooser = await fileChooserPromise;
        await fileChooser.setFiles(filePath);
        await expect(this.page.locator('text=Cluster added')).toBeVisible();
    }

    async connectToCluster(clusterName: string) {
        const row = this.page.locator(`text=${clusterName}`).locator('xpath=..');
        await row.getByRole('button', { name: 'Connect' }).click();
        await expect(this.page).toHaveURL(/\/home/);
    }
}
