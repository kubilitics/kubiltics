import { test, expect } from '@playwright/test';

test('pod terminal handles live interactive I/O across pod, kcli, and kubectl sources', async ({ page }) => {
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
          activeNamespace: 'all',
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
    localStorage.setItem('kubilitics-pod-terminal-source', 'pod');
    localStorage.setItem('kubilitics-pod-terminal-kcli-mode', 'ui');

    const NativeWebSocket = window.WebSocket;

    class FakeSocket {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;

      readonly url: string;
      readonly protocol = '';
      readonly extensions = '';
      binaryType: BinaryType = 'blob';
      bufferedAmount = 0;
      readyState = FakeSocket.CONNECTING;

      onopen: ((this: WebSocket, ev: Event) => unknown) | null = null;
      onerror: ((this: WebSocket, ev: Event) => unknown) | null = null;
      onclose: ((this: WebSocket, ev: CloseEvent) => unknown) | null = null;
      onmessage: ((this: WebSocket, ev: MessageEvent) => unknown) | null = null;

      private listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
      private stdinBuffer = '';

      constructor(url: string) {
        this.url = String(url);

        // Emit an early payload before `open` to validate frontend output buffering.
        setTimeout(() => {
          this.emitOut('stdout', 'Connected to remote shell\r\n');
          this.readyState = FakeSocket.OPEN;
          this.dispatch('open', new Event('open'));
          this.emitOut('stdout', '$ ');
        }, 0);
      }

      addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
        if (!this.listeners.has(type)) this.listeners.set(type, new Set());
        this.listeners.get(type)!.add(listener);
      }

      removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
        this.listeners.get(type)?.delete(listener);
      }

      dispatchEvent(event: Event): boolean {
        this.dispatch(event.type, event);
        return true;
      }

      send(payload: string | ArrayBufferLike | Blob | ArrayBufferView) {
        if (typeof payload !== 'string') return;
        let msg: { t?: string; d?: string } = {};
        try {
          msg = JSON.parse(payload);
        } catch {
          return;
        }

        if (msg.t !== 'stdin' || !msg.d) return;

        this.stdinBuffer += atob(msg.d);

        // xterm sends character chunks; execute only on Enter.
        const parts = this.stdinBuffer.split(/\r\n|\n|\r/);
        this.stdinBuffer = parts.pop() ?? '';
        for (const raw of parts) {
          const text = raw.trim();
          if (!text) {
            this.emitOut('stdout', '$ ');
            continue;
          }
          if (text === 'ls') {
            this.emitOut('stdout', 'app  bin  etc\r\n$ ');
            continue;
          }
          if (text === 'pwd') {
            this.emitOut('stdout', '/app\r\n$ ');
            continue;
          }
          if (text === 'status') {
            this.emitOut('stdout', 'kcli status: healthy\r\n$ ');
            continue;
          }
          this.emitOut('stdout', `executed: ${text}\r\n$ `);
        }
      }

      close() {
        if (this.readyState === FakeSocket.CLOSED) return;
        this.readyState = FakeSocket.CLOSED;
        const ev = new CloseEvent('close', { code: 1000, reason: 'normal closure', wasClean: true });
        this.dispatch('close', ev);
      }

      private emitOut(type: 'stdout' | 'stderr', text: string) {
        const payload = JSON.stringify({ t: type, d: btoa(text) });
        const ev = new MessageEvent('message', { data: payload });
        this.dispatch('message', ev);
      }

      private dispatch(type: string, event: Event) {
        const propHandler =
          type === 'open'
            ? this.onopen
            : type === 'message'
              ? this.onmessage
              : type === 'error'
                ? this.onerror
                : type === 'close'
                  ? this.onclose
                  : null;
        if (propHandler) propHandler.call(this as unknown as WebSocket, event as never);
        const set = this.listeners.get(type);
        if (!set) return;
        for (const listener of set) {
          if (typeof listener === 'function') listener.call(this, event);
          else listener.handleEvent(event);
        }
      }
    }

    const shouldStub = (url: string) =>
      /\/api\/v1\/clusters\/[^/]+\/(pods\/.+\/exec|shell\/stream|kcli\/stream)/.test(url);

    const WrappedWebSocket = function (
      this: unknown,
      url: string | URL,
      protocols?: string | string[]
    ): WebSocket {
      const s = String(url);
      if (shouldStub(s)) {
        return new FakeSocket(s) as unknown as WebSocket;
      }
      return new NativeWebSocket(url, protocols);
    } as unknown as typeof WebSocket;

    WrappedWebSocket.CONNECTING = NativeWebSocket.CONNECTING;
    WrappedWebSocket.OPEN = NativeWebSocket.OPEN;
    WrappedWebSocket.CLOSING = NativeWebSocket.CLOSING;
    WrappedWebSocket.CLOSED = NativeWebSocket.CLOSED;
    WrappedWebSocket.prototype = NativeWebSocket.prototype;
    window.WebSocket = WrappedWebSocket;
  });

  const fakePod = {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: {
      name: 'demo-pod',
      namespace: 'default',
      uid: 'demo-pod-uid',
      creationTimestamp: '2026-02-10T10:00:00Z',
      labels: { app: 'demo' },
    },
    spec: {
      nodeName: 'node-1',
      restartPolicy: 'Always',
      dnsPolicy: 'ClusterFirst',
      containers: [
        {
          name: 'main',
          image: 'nginx:latest',
          ports: [{ containerPort: 80, protocol: 'TCP' }],
          resources: {
            requests: { cpu: '10m', memory: '32Mi' },
            limits: { cpu: '100m', memory: '128Mi' },
          },
        },
      ],
    },
    status: {
      phase: 'Running',
      podIP: '10.0.0.10',
      hostIP: '192.168.1.20',
      qosClass: 'Burstable',
      containerStatuses: [
        {
          name: 'main',
          ready: true,
          restartCount: 0,
          image: 'nginx:latest',
          state: { running: { startedAt: '2026-02-10T10:00:10Z' } },
        },
      ],
      conditions: [
        { type: 'Ready', status: 'True', lastTransitionTime: '2026-02-10T10:00:20Z' },
      ],
    },
  };

  await page.route('**/api/v1/clusters/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;

    if (path.includes('/resources/pods/default/demo-pod')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(fakePod),
      });
      return;
    }

    if (path.includes('/resources/')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [], metadata: {} }),
      });
      return;
    }

    if (path.endsWith('/events')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
      return;
    }

    if (path.includes('/metrics/summary')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          summary: {
            cluster_id: 'prod-us-east',
            namespace: 'default',
            resource_type: 'pod',
            resource_name: 'demo-pod',
            total_cpu: '10m',
            total_memory: '32Mi',
            pod_count: 1,
            pods: [
              {
                name: 'demo-pod',
                namespace: 'default',
                cpu: '10m',
                memory: '32Mi',
                containers: [{ name: 'main', cpu: '10m', memory: '32Mi' }],
              },
            ],
          },
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({}),
    });
  });

  await page.goto('/pods/default/demo-pod?tab=terminal');

  // xterm path should be active and live.
  await expect(page.getByText('/bin/sh').first()).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.xterm-helper-textarea')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.xterm-rows')).toContainText('Connected to remote shell');

  // Pod exec command roundtrip.
  const termInput = page.locator('.xterm-helper-textarea').first();
  await termInput.click();
  await termInput.type('ls');
  await termInput.press('Enter');
  await expect(page.locator('.xterm-rows')).toContainText('app  bin  etc');

  // Switch to kcli source and verify interactive input.
  await page.getByTitle('Cluster kcli terminal').click();
  await expect(page.locator('.xterm-helper-textarea')).toBeVisible();
  await termInput.click();
  await termInput.type('status');
  await termInput.press('Enter');
  await expect(page.locator('.xterm-rows')).toContainText('kcli status: healthy');

  // Switch kcli mode and verify session remains interactive.
  await page.getByTitle('kcli shell mode').click();
  await termInput.click();
  await termInput.type('pwd');
  await termInput.press('Enter');
  await expect(page.locator('.xterm-rows')).toContainText('/app');

  // Switch to kubectl shell source and validate input path.
  await page.getByTitle('Cluster kubectl shell').click();
  await termInput.click();
  await termInput.type('pwd');
  await termInput.press('Enter');
  await expect(page.locator('.xterm-rows')).toContainText('/app');
});
