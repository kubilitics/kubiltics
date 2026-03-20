import { chromium } from 'playwright';

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({
        viewport: { width: 1920, height: 1080 }
    });

    console.log('Navigating to Add-ons page...');
    await page.goto('http://127.0.0.1:5173/addons', { waitUntil: 'commit', timeout: 30000 });

    // Wait for Vite to pre-bundle and the React app to render the catalog
    console.log('Waiting for render...');
    await page.waitForTimeout(15000);

    // Capture full page screenshot
    await page.screenshot({ path: '/Users/koti/myFuture/Kubernetes/kubilitics-os-emergent/kubilitics-frontend/catalog_screenshot.png', fullPage: true });
    console.log('Screenshot saved to catalog_screenshot.png');

    await browser.close();
})();
