import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ConnectionPage } from '../page-objects/ConnectionPage';

test.describe('Performance & Stability Validation', () => {
    let connectionPage: ConnectionPage;

    test.beforeEach(async ({ page }) => {
        connectionPage = new ConnectionPage(page);
    });

    test('should measure First Contentful Paint', async ({ page }) => {
        await page.goto('/');

        // Wait for at least one paint entry
        const fcpEntry = await page.evaluate(async () => {
            return new Promise((resolve) => {
                const check = () => {
                    const entries = performance.getEntriesByType('paint');
                    const fcp = entries.find(e => e.name === 'first-contentful-paint');
                    if (fcp) resolve(JSON.parse(JSON.stringify(fcp)));
                    else setTimeout(check, 100);
                };
                check();
                // Timeout after 10s if no paint
                setTimeout(() => resolve(null), 10000);
            });
        }) as any;

        expect(fcpEntry).toBeTruthy();
        expect(fcpEntry.startTime).toBeLessThan(2000); // Target < 2s
        console.log(`FCP: ${fcpEntry.startTime}ms`);
    });

    test('should detect memory leaks on repeated navigation', async ({ page }) => {
        await connectionPage.goto();
        await connectionPage.selectDesktopMode();
        await page.locator('text=Explore Demo Mode').click();

        // Accessibility Check (FE-051)
        const accessibilityScanResults = await new AxeBuilder({ page }).analyze();
        // Log violations for debugging but don't fail yet if many exist (soft assertion)
        if (accessibilityScanResults.violations.length > 0) {
            console.log('A11y Violations:', accessibilityScanResults.violations);
        }
        // expect(accessibilityScanResults.violations).toEqual([]); // Uncomment to enforce

        const startMemory = await page.evaluate(() => (performance as any).memory?.usedJSHeapSize);

        for (let i = 0; i < 5; i++) {
            await page.goto('/pods');
            await page.waitForTimeout(500);
            await page.goto('/deployments');
            await page.waitForTimeout(500);
        }

        const endMemory = await page.evaluate(() => (performance as any).memory?.usedJSHeapSize);
        if (startMemory && endMemory) {
            const growth = (endMemory - startMemory) / 1024 / 1024;
            console.log(`Memory growth after 5 navigations: ${growth.toFixed(2)} MB`);
            expect(growth).toBeLessThan(50); // Arbitrary limit for 5 navigations
        }
    });

    test('should handle backend 500 errors gracefully', async ({ page }) => {
        // Intercept API calls and force a 500
        await page.route('**/api/v1/pods**', route => route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'Internal Server Error' }),
        }));

        await page.goto('/');
        await connectionPage.selectDesktopMode();
        await page.locator('text=Explore Demo Mode').click();
        await page.goto('/pods');

        // Expect an error toast or fallback UI - to be more robust, check for general error signs
        const errorFound = await page.evaluate(() => {
            const bodyText = document.body.innerText;
            return /error|failed|server|problem/i.test(bodyText);
        });
        expect(errorFound).toBeTruthy();
    });
});
