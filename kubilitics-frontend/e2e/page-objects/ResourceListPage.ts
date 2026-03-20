import { Page, expect, Locator } from '@playwright/test';
import { BasePage } from './BasePage';

export class ResourceListPage extends BasePage {
    readonly searchInput: Locator;
    readonly namespaceFilter: Locator;
    readonly resourceTable: Locator;
    readonly tableRows: Locator;
    readonly sortHeader: (column: string) => Locator;
    readonly firstRowName: Locator;

    constructor(page: Page) {
        super(page);
        this.searchInput = page.locator('input[placeholder*="Search"]');
        this.namespaceFilter = page.locator('button:has-text("Namespace")'); // Target the filter button/selector
        this.resourceTable = page.locator('table');
        // Filter out skeleton rows if any
        this.tableRows = page.locator('tbody tr:not(.animate-pulse)');
        this.sortHeader = (column: string) => page.locator(`th:has-text("${column}")`);
        this.firstRowName = page.locator('tbody tr:not(.animate-pulse):first-child td:first-child');
    }

    async navigateTo(resourceType: string) {
        await this.page.goto(`/${resourceType}`);
        await this.waitForNetworkIdle();
        // Wait for at least one non-skeleton row to appear or the empty state
        await Promise.race([
            this.tableRows.first().waitFor({ state: 'visible', timeout: 5000 }),
            this.page.locator('text=No pods|not found|No results').first().waitFor({ state: 'visible', timeout: 5000 })
        ]).catch(() => { }); // Continue anyway
    }

    async search(query: string) {
        await this.searchInput.fill(query);
        await this.page.waitForTimeout(500); // Debounce
    }

    async filterByNamespace(namespace: string) {
        await this.namespaceFilter.click();
        await this.page.locator(`text=${namespace}`).click();
        await this.waitForNetworkIdle();
    }

    async sortByColumn(columnName: string) {
        await this.page.locator(`th:has-text("${columnName}")`).click();
        await this.waitForNetworkIdle();
    }

    async openResourceDetail(name: string) {
        await this.page.locator(`text=${name}`).first().click();
        await expect(this.page).toHaveURL(/\/.*\/.*/);
    }

    async getRowCount() {
        return await this.tableRows.count();
    }
}
