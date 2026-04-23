// Release 1.1.0 — 9-page smoke.
// Visits every top-level page that ships in v1.1.0 and asserts it doesn't
// crash. Treats React error boundary, unhandled runtime error, or a blank
// body as a failure. Captures a screenshot per page for the release notes.
//
// Runs against a dev server (see playwright.config.ts webServer).
// The kind-kubilitics-test cluster should be active in the UI; if not,
// pages that require a connection will still render (empty-state or
// ConnectionRequiredBanner), which is acceptable — we only fail on crashes.

import { test, expect, Page, ConsoleMessage } from '@playwright/test';

interface PageSpec {
    name: string;
    path: string;
}

const RELEASE_PAGES: PageSpec[] = [
    { name: 'Dashboard', path: '/dashboard' },
    { name: 'Topology', path: '/topology' },
    { name: 'Simulation', path: '/simulation' },
    { name: 'Reports', path: '/report-schedules' },
    { name: 'Auto-Pilot', path: '/auto-pilot' },
    { name: 'Advisor (Health)', path: '/health' },
    { name: 'Cost (Cluster)', path: '/cluster' },
    { name: 'Security', path: '/security' },
    { name: 'Observability (Events)', path: '/events-intelligence' },
];

// Console errors we accept as environmental (not release blockers).
const BENIGN_CONSOLE_PATTERNS = [
    /ResizeObserver loop/i,
    /\[HMR\]/i,
    /Non-Error promise rejection captured/i,
    /Failed to load resource.*favicon/i,
    /kubectl.*connection refused/i,
];

async function visitAndCheck(page: Page, spec: PageSpec) {
    const consoleErrors: string[] = [];
    const handler = (msg: ConsoleMessage) => {
        if (msg.type() !== 'error') return;
        const text = msg.text();
        if (BENIGN_CONSOLE_PATTERNS.some((re) => re.test(text))) return;
        consoleErrors.push(text);
    };
    page.on('console', handler);

    await page.goto(spec.path, { waitUntil: 'domcontentloaded' });

    // Wait for React to render actual content into #root. ProtectedRoute may
    // redirect to /connect via <Navigate>, showing a blank frame mid-redirect.
    // Retry reading body until it has real content, accounting for the fact
    // that waitForFunction can be cancelled by an in-flight React Router
    // navigation ("Execution context was destroyed").
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
        const len = await page.evaluate(() => (document.body.innerText || '').trim().length).catch(() => 0);
        if (len > 50) break;
        await page.waitForTimeout(250).catch(() => undefined);
    }

    const body = await page.locator('body').textContent();
    expect(body, `${spec.name} — body should not be blank`).toBeTruthy();
    expect((body ?? '').length, `${spec.name} — body should have content`).toBeGreaterThan(100);
    expect(body, `${spec.name} — no error boundary`).not.toContain('Something went wrong');
    expect(body, `${spec.name} — no React unhandled error`).not.toContain('Unhandled Runtime Error');
    expect(body, `${spec.name} — no Vite error overlay`).not.toContain('vite-error-overlay');

    await page.screenshot({
        path: `test-results/release-1.1.0-smoke/${spec.name.replace(/[^\w]+/g, '_')}.png`,
        fullPage: true,
    });

    page.off('console', handler);

    if (consoleErrors.length > 0) {
        // Surface, don't fail — console errors on K8s-disconnected dev often
        // look noisy; a real regression is covered by DOM assertions above.
        console.log(`[${spec.name}] console errors (non-fatal):\n  - ${consoleErrors.join('\n  - ')}`);
    }
}

test.describe('Release 1.1.0 — 9-page smoke', () => {
    test.beforeEach(async ({ page }) => {
        // Land on the app root so Zustand stores hydrate from localStorage.
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(500);
    });

    for (const spec of RELEASE_PAGES) {
        test(`${spec.name} (${spec.path})`, async ({ page }) => {
            await visitAndCheck(page, spec);
        });
    }
});
