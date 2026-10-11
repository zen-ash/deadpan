import { WS_PATH, type ClientToServer, type HostToServer, type ServerToClient } from '@deadpan/shared';
import { ClockSync } from './clock';

/** A burst of quick pings right after connecting gets the clock synced, then one every 2 s. */
const BURST_PINGS = 5;
const BURST_GAP_MS = 150;
const PING_EVERY_MS = 2000;
/**
 * No pong for this long means the connection is dead even if the browser hasn't noticed (phones
 * switching networks or waking up), so reconnect instead of waiting for it to time out.
 */
const PONG_TIMEOUT_MS = 7000;

export interface SocketHandlers {
  /** Runs after every connect and reconnect, so (re)send join messages here. */
  onOpen?: () => void;
  onMessage: (msg: ServerToClient) => void;
  /** Binary frames (face meshes on the big screen). */
  onBinary?: (data: ArrayBuffer) => void;
  onConnectedChange?: (connected: boolean) => void;
}

/** What the big screen needs from its connection: the live socket, or demo mode's playback. */
export interface Link {
  readonly clock: { now(): number; toServer(local: number): number };
  send(msg: ClientToServer | HostToServer): void;
  close(): void;
}

/** A WebSocket to the game server that reconnects with backoff and keeps the clock synced. */
export class RoomSocket implements Link {
  readonly clock = new ClockSync();
  private ws: WebSocket | null = null;
  private stopped = false;
  private retries = 0;
  private retryTimer: number | undefined;
  private pingTimer: number | undefined;
  private lastPongAt = 0;

  constructor(private readonly handlers: SocketHandlers) {
    this.connect();
  }

  private connect() {
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${protocol}://${location.host}${WS_PATH}`);
    this.ws = ws;
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      this.retries = 0;
      this.lastPongAt = Date.now();
      this.startPinging();
      this.handlers.onConnectedChange?.(true);
      this.handlers.onOpen?.();
    };
    ws.onmessage = (event) => {
      if (this.stopped) return;
      if (event.data instanceof ArrayBuffer) {
        this.handlers.onBinary?.(event.data);
        return;
      }
      if (typeof event.data !== 'string') return;
      let msg: ServerToClient;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (msg.t === 'pong') {
        this.lastPongAt = Date.now();
        this.clock.onPong(msg.c, msg.s);
      }
      this.handlers.onMessage(msg);
    };
    ws.onclose = () => {
      // A closed RoomSocket stays silent. Otherwise its late close (React dev mode opens and
      // closes one right away) would mark its replacement's screen as disconnected.
      if (this.stopped || this.ws !== ws) return;
      this.reconnect();
    };
  }

  private reconnect() {
    clearTimeout(this.pingTimer);
    clearTimeout(this.retryTimer);
    this.handlers.onConnectedChange?.(false);
    const delay = Math.min(5000, 400 * 2 ** this.retries++);
    this.retryTimer = window.setTimeout(() => this.connect(), delay);
  }

  private startPinging() {
    clearTimeout(this.pingTimer);
    let sent = 0;
    const ping = () => {
      const ws = this.ws;
      if (ws?.readyState === WebSocket.OPEN && Date.now() - this.lastPongAt > PONG_TIMEOUT_MS) {
        // Drop the dead socket without waiting for its close handshake; its late close is ignored.
        this.ws = null;
        ws.close();
        this.reconnect();
        return;
      }
      this.send({ t: 'ping', c: Date.now() });
      sent++;
      this.pingTimer = window.setTimeout(ping, sent < BURST_PINGS ? BURST_GAP_MS : PING_EVERY_MS);
    };
    ping();
  }

  get connected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  send(msg: ClientToServer | HostToServer) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  /** Sends a binary frame, dropping it while the connection is backed up (the next one is 100 ms away). */
  sendBinary(data: Int16Array<ArrayBuffer>) {
    const ws = this.ws;
    if (ws?.readyState === WebSocket.OPEN && ws.bufferedAmount < 64 * 1024) ws.send(data);
  }

  close() {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    clearTimeout(this.pingTimer);
    const ws = this.ws;
    // Closing mid-handshake logs a browser warning, so wait for the handshake to finish.
    if (ws?.readyState === WebSocket.CONNECTING) ws.onopen = () => ws.close();
    else ws?.close();
  }
}
