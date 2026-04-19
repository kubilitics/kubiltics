import type { ClientFrame, ServerFrame } from './protocol';
import type { ConnectionState } from '@/stores/chatStore';

export class ChatClient {
  private ws: WebSocket | null = null;
  private currentState: ConnectionState = 'idle';

  constructor(
    private url: string,
    private onFrame: (f: ServerFrame) => void,
    private onState: (s: ConnectionState, err?: string) => void
  ) {}

  state(): ConnectionState {
    return this.currentState;
  }

  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws) return resolve();
      this.setState('connecting');
      const ws = new WebSocket(this.url);
      this.ws = ws;

      ws.onopen = () => {
        this.setState('open');
        resolve();
      };
      ws.onmessage = (ev) => {
        try {
          const frame = JSON.parse(String(ev.data)) as ServerFrame;
          this.onFrame(frame);
        } catch (e) {
          console.error('[chatClient] malformed frame:', e);
        }
      };
      ws.onerror = () => {
        this.setState('error', 'websocket error');
        reject(new Error('ws error'));
      };
      ws.onclose = (ev) => {
        if (this.currentState !== 'error') {
          this.setState('idle');
        }
        this.ws = null;
        if (!ev.wasClean) {
          this.setState('error', `closed code=${ev.code}`);
        }
      };
    });
  }

  send(frame: ClientFrame): void {
    if (!this.ws || this.currentState !== 'open') {
      throw new Error(`chatClient: cannot send in state ${this.currentState}`);
    }
    this.ws.send(JSON.stringify(frame));
  }

  close(): void {
    if (this.ws) {
      this.ws.close(1000, 'client closing');
      this.ws = null;
    }
  }

  private setState(s: ConnectionState, err?: string) {
    this.currentState = s;
    this.onState(s, err);
  }
}
