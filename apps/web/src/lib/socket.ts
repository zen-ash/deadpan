import { WS_PATH, type ClientToServer, type HostToServer, type ServerToClient } from '@deadpan/shared';

export interface SocketHandlers {
  /** Runs after every connect and reconnect, so (re)send join messages here. */
  onOpen?: () => void;
  onMessage: (msg: ServerToClient) => void;
  onConnectedChange?: (connected: boolean) => void;
}

/** A WebSocket to the game server that reconnects with backoff until closed. */
export class RoomSocket {
  private ws: WebSocket | null = null;
  private stopped = false;
  private retries = 0;
  private retryTimer: number | undefined;

  constructor(private readonly handlers: SocketHandlers) {
    this.connect();
  }

  private connect() {
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${protocol}://${location.host}${WS_PATH}`);
    this.ws = ws;

    ws.onopen = () => {
      this.retries = 0;
      this.handlers.onConnectedChange?.(true);
      this.handlers.onOpen?.();
    };
    ws.onmessage = (event) => {
      if (this.stopped || typeof event.data !== 'string') return;
      let msg: ServerToClient;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      this.handlers.onMessage(msg);
    };
    ws.onclose = () => {
      // A closed RoomSocket stays silent. Otherwise its late close (React dev mode opens and
      // closes one right away) would mark its replacement's screen as disconnected.
      if (this.stopped || this.ws !== ws) return;
      this.handlers.onConnectedChange?.(false);
      const delay = Math.min(5000, 400 * 2 ** this.retries++);
      this.retryTimer = window.setTimeout(() => this.connect(), delay);
    };
  }

  get connected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  send(msg: ClientToServer | HostToServer) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  close() {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    const ws = this.ws;
    // Closing mid-handshake logs a browser warning, so wait for the handshake to finish.
    if (ws?.readyState === WebSocket.CONNECTING) ws.onopen = () => ws.close();
    else ws?.close();
  }
}
