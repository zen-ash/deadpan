import type { FeaturesPacket, PlayerInfo, ServerToClient } from '@deadpan/shared';
import type { WebSocket } from 'ws';
import type { ImposterGame } from './game';

/** How much signal history to keep per player, for baselines and answer windows. */
const HISTORY_MS = 120_000;
/** Live data to a host is skipped while this much is still queued (a slow big-screen link). */
const HOST_BACKLOG_BYTES = 256 * 1024;

export interface Sample {
  /** Server receive time. */
  at: number;
  f: FeaturesPacket;
}

export interface SpeechEvent {
  /** Server time the speech started or stopped (from the phone's synced clock). */
  at: number;
  on: boolean;
}

export interface Player extends PlayerInfo {
  ws: WebSocket;
  /** Latest 10 Hz features from the phone. */
  features: FeaturesPacket | null;
  samples: Sample[];
  speech: SpeechEvent[];
}

export interface Room {
  code: string;
  players: Map<string, Player>;
  hosts: Set<WebSocket>;
  game: ImposterGame;
  cleanup?: NodeJS.Timeout;
}

export function send(ws: WebSocket, msg: ServerToClient) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

export function sendToHosts(room: Room, msg: ServerToClient | Buffer, { live = false } = {}) {
  const data = Buffer.isBuffer(msg) ? msg : JSON.stringify(msg);
  for (const ws of room.hosts) {
    if (ws.readyState !== ws.OPEN) continue;
    // Live signal frames are dropped for a backed-up host; game messages never are.
    if (live && ws.bufferedAmount > HOST_BACKLOG_BYTES) continue;
    ws.send(data);
  }
}

/** To every host and every phone in the room. */
export function broadcast(room: Room, msg: ServerToClient) {
  const data = JSON.stringify(msg);
  for (const ws of room.hosts) if (ws.readyState === ws.OPEN) ws.send(data);
  for (const p of room.players.values()) if (p.ws.readyState === p.ws.OPEN) p.ws.send(data);
}

export function recordSample(player: Player, f: FeaturesPacket) {
  const now = Date.now();
  player.features = f;
  player.samples.push({ at: now, f });
  while (player.samples.length > 0 && now - player.samples[0]!.at > HISTORY_MS) player.samples.shift();
}

export function recordSpeech(player: Player, event: SpeechEvent) {
  player.speech.push(event);
  while (player.speech.length > 0 && Date.now() - player.speech[0]!.at > HISTORY_MS) player.speech.shift();
}
