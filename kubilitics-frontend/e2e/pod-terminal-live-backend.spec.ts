import { test, expect } from '@playwright/test';

const clusterId = process.env.PLAYWRIGHT_CLUSTER_ID ?? '';
const clusterName = process.env.PLAYWRIGHT_CLUSTER_NAME ?? 'playwright-cluster';
const podNamespace = process.env.PLAYWRIGHT_POD_NAMESPACE ?? '';
const podName = process.env.PLAYWRIGHT_POD_NAME ?? '';
const backendBaseUrl = process.env.PLAYWRIGHT_BACKEND_BASE_URL ?? '';
const runClusterShellChecks = process.env.PLAYWRIGHT_TEST_CLUSTER_SHELL === '1';

const hasLivePodConfig = Boolean(clusterId && podNamespace && podName);

function buildActiveCluster() {
  return {
    id: clusterId,
    name: clusterName,
    context: clusterName,
    version: 'v1.29.0',
    status: 'healthy',
    region: 'unknown',
    provider: 'on-prem',
    nodes: 1,
    namespaces: 1,
    pods: { running: 1, pending: 0, failed: 0 },
    cpu: { used: 0, total: 100 },
    memory: { used: 0, total: 100 },
  };
}

test.describe('pod terminal live backend', () => {
  test.skip(
    !hasLivePodConfig,
    'Set PLAYWRIGHT_CLUSTER_ID, PLAYWRIGHT_POD_NAMESPACE, PLAYWRIGHT_POD_NAME to run live pod terminal tests.'
  );

  test.beforeEach(async ({ page }) => {
    const activeCluster = buildActiveCluster();
    await page.addInitScript(
      ({ seededCluster, seededBackendBaseUrl }) => {
        localStorage.setItem(
          'kubilitics-cluster',
          JSON.stringify({
            state: {
              clusters: [seededCluster],
              activeCluster: seededCluster,
              activeNamespace: 'all',
              namespaces: [],
              isDemo: false,
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
              backendBaseUrl: seededBackendBaseUrl,
              currentClusterId: seededCluster.id,
            },
            version: 0,
          })
        );
        localStorage.setItem('kubilitics-pod-terminal-source', 'pod');
        localStorage.setItem('kubilitics-pod-terminal-kcli-mode', 'ui');
      },
      { seededCluster: activeCluster, seededBackendBaseUrl: backendBaseUrl }
    );
  });

  test('supports interactive pod exec without kubectl in user terminal', async ({ page }) => {
    const token = `KUBILITICS_E2E_${Date.now()}`;
    await page.goto(`/pods/${encodeURIComponent(podNamespace)}/${encodeURIComponent(podName)}?tab=terminal`);

    await expect(page.getByText('/bin/sh').first()).toBeVisible({ timeout: 30000 });
    await expect(page.getByText('Live').first()).toBeVisible({ timeout: 30000 });
    await expect(page.locator('.xterm-helper-textarea').first()).toBeVisible({ timeout: 30000 });

    const termInput = page.locator('.xterm-helper-textarea').first();
    await termInput.click();
    await termInput.type(`echo ${token}`);
    await termInput.press('Enter');

    await expect(page.locator('.xterm-rows')).toContainText(token, { timeout: 30000 });

    await termInput.type('pwd');
    await termInput.press('Enter');
    await expect(page.locator('.xterm-rows')).toContainText('/', { timeout: 30000 });
  });

  test('optional: supports cluster-shell source switching', async ({ page }) => {
    test.skip(!runClusterShellChecks, 'Set PLAYWRIGHT_TEST_CLUSTER_SHELL=1 to enable kcli/kubectl source checks.');

    await page.goto(`/pods/${encodeURIComponent(podNamespace)}/${encodeURIComponent(podName)}?tab=terminal`);
    await expect(page.getByText('/bin/sh').first()).toBeVisible({ timeout: 30000 });

    const termInput = page.locator('.xterm-helper-textarea').first();
    await termInput.click();

    await page.getByTitle('Cluster kubectl shell').click();
    await expect(page.getByText('kubectl').first()).toBeVisible({ timeout: 30000 });

    await termInput.click();
    await termInput.type('echo KUBECTL_SOURCE_OK');
    await termInput.press('Enter');
    await expect(page.locator('.xterm-rows')).toContainText('KUBECTL_SOURCE_OK', { timeout: 30000 });

    await page.getByTitle('Cluster kcli terminal').click();
    await expect(page.getByText('kcli').first()).toBeVisible({ timeout: 30000 });

    await termInput.click();
    await termInput.type('echo KCLI_SOURCE_OK');
    await termInput.press('Enter');
    await expect(page.locator('.xterm-rows')).toContainText('KCLI_SOURCE_OK', { timeout: 30000 });
  });
});
