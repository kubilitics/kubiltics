import { test, expect } from '@playwright/test';

test('cluster shell synchronizes context/namespace/AI state from backend TUI state', async ({ page }) => {
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

      constructor(url: string) {
        this.url = String(url);
        setTimeout(() => {
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
        if (msg.t === 'stdin') {
          this.emitOut('stdout', '\r\n$ ');
        }
      }
      close() {
        if (this.readyState === FakeSocket.CLOSED) return;
        this.readyState = FakeSocket.CLOSED;
        this.dispatch('close', new CloseEvent('close', { code: 1000, reason: 'normal closure', wasClean: true }));
      }
      private emitOut(type: 'stdout' | 'stderr', text: string) {
        const ev = new MessageEvent('message', { data: JSON.stringify({ t: type, d: btoa(text) }) });
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
      /\/api\/v1\/clusters\/[^/]+\/(kcli\/stream|shell\/stream)/.test(url);
    const WrappedWebSocket = function (
      this: unknown,
      url: string | URL,
      protocols?: string | string[]
    ): WebSocket {
      const s = String(url);
      if (shouldStub(s)) return new FakeSocket(s) as unknown as WebSocket;
      return new NativeWebSocket(url, protocols);
    } as unknown as typeof WebSocket;
    WrappedWebSocket.CONNECTING = NativeWebSocket.CONNECTING;
    WrappedWebSocket.OPEN = NativeWebSocket.OPEN;
    WrappedWebSocket.CLOSING = NativeWebSocket.CLOSING;
    WrappedWebSocket.CLOSED = NativeWebSocket.CLOSED;
    WrappedWebSocket.prototype = NativeWebSocket.prototype;
    window.WebSocket = WrappedWebSocket;
  });

  let stateCalls = 0;
  await page.route('**/api/v1/clusters/prod-us-east/kcli/tui/state', async (route) => {
    stateCalls += 1;
    const body = stateCalls < 2
      ? {
        clusterId: 'prod-us-east',
        clusterName: 'production-us-east',
        context: 'prod-us-east-1',
        namespace: 'default',
        kcliAvailable: true,
        kcliShellModeAllowed: true,
        aiEnabled: false,
      }
      : {
        clusterId: 'prod-us-east',
        clusterName: 'production-us-east',
        context: 'prod-us-east-2',
        namespace: 'kube-system',
        kcliAvailable: true,
        kcliShellModeAllowed: true,
        aiEnabled: true,
      };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });

  await page.goto('/pods');
  await page.getByRole('button', { name: /Shell/i }).first().click();
  await expect(page.getByText(/Namespace: .*default/i).first()).toBeVisible({ timeout: 5000 });

  await page.locator('.xterm-screen').first().click();
  await page.keyboard.press('Enter');

  await expect(page.getByText(/Namespace: .*kube-system/i).first()).toBeVisible({ timeout: 2000 });
  await expect(page.getByText(/AI On/i).first()).toBeVisible({ timeout: 2000 });
  await expect(page.getByText(/Context: .*prod-us-east-2/i).first()).toBeVisible({ timeout: 2000 });
});
