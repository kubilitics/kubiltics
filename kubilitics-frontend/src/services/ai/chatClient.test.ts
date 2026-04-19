import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Server, WebSocket as MockWS } from 'mock-socket';
import { ChatClient } from './chatClient';

let server: Server;
const TEST_URL = 'ws://localhost:9999/api/v1/ai/chat?cluster_id=c1';

beforeEach(() => {
  // mock-socket replaces global WebSocket inside the module under test.
  (globalThis as unknown as { WebSocket: typeof WebSocket }).WebSocket = MockWS as unknown as typeof WebSocket;
  server = new Server(TEST_URL);
});

afterEach(() => {
  server.stop();
});

describe('ChatClient', () => {
  it('open() connects and resolves', async () => {
    const c = new ChatClient(TEST_URL, () => {}, () => {});
    await c.open();
    expect(c.state()).toBe('open');
    c.close();
  });

  it('send() writes JSON frames', async () => {
    const received: string[] = [];
    server.on('connection', (sock) => {
      sock.on('message', (msg) => received.push(String(msg)));
    });
    const c = new ChatClient(TEST_URL, () => {}, () => {});
    await c.open();
    c.send({ type: 'user_message', payload: { text: 'hi', session_id: 's1', turn_id: 't1' } });
    await new Promise((r) => setTimeout(r, 20));
    expect(received).toHaveLength(1);
    expect(JSON.parse(received[0]!)).toMatchObject({ type: 'user_message' });
    c.close();
  });

  it('onFrame fires for inbound JSON', async () => {
    const onFrame = vi.fn();
    server.on('connection', (sock) => {
      sock.send(JSON.stringify({ type: 'text_delta', payload: { anchor_id: 'a1', text: 'hi' } }));
    });
    const c = new ChatClient(TEST_URL, onFrame, () => {});
    await c.open();
    await new Promise((r) => setTimeout(r, 20));
    expect(onFrame).toHaveBeenCalledWith({ type: 'text_delta', payload: { anchor_id: 'a1', text: 'hi' } });
    c.close();
  });

  it('onState reports lifecycle', async () => {
    const onState = vi.fn();
    const c = new ChatClient(TEST_URL, () => {}, onState);
    await c.open();
    c.close();
    expect(onState).toHaveBeenCalledWith('connecting', undefined);
    expect(onState).toHaveBeenCalledWith('open', undefined);
  });
});
