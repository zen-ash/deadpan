import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import {
  MAX_NAME_LENGTH,
  MAX_PLAYERS,
  MESH_HEADER,
  MESH_MAGIC,
  MESH_POINTS,
  normalizeRoomCode,
  type ClientToServer,
  type ErrorCode,
  type FeaturesPacket,
  type HostToServer,
} from '@deadpan/shared';
import { ImposterGame } from './game';
import { broadcast, recordSample, recordSpeech, send, sendToHosts, type Player, type Room } from './room';

type Conn =
  | { role: 'none' }
  | { role: 'host'; room: Room }
  | { role: 'player'; room: Room; player: Player };

const EMPTY_ROOM_TTL_MS = 10 * 60_000;
const HEARTBEAT_MS = 15_000;
const MESH_BYTES = (MESH_HEADER + MESH_POINTS.length * 3) * 2;
/**
 * Speech events and "line finished" reports are sent the moment they happen, so their synced
 * timestamps must land just before the message arrived. Outside these windows the sender's clock
 * sync is off, and the server's receive time (less the usual detection delay) is used instead.
 */
const SPEECH_WINDOW = { before: 3000, after: 300, fallbackLag: 250 };
const LINE_END_WINDOW = { before: 2000, after: 300, fallbackLag: 0 };

const rooms = new Map<string, Room>();

function getRoom(code: string): Room {
  let room = rooms.get(code);
  if (!room) {
    const created = { code, players: new Map(), hosts: new Set() } as Omit<Room, 'game'> as Room;
    created.game = new ImposterGame(created);
    rooms.set(code, created);
    room = created;
    console.log(`[room ${code}] created`);
  }
  clearTimeout(room.cleanup);
  room.cleanup = undefined;
  return room;
}

function scheduleCleanup(room: Room) {
  if (room.players.size > 0 || room.hosts.size > 0) return;
  clearTimeout(room.cleanup);
  room.cleanup = setTimeout(() => {
    room.game.dispose();
    rooms.delete(room.code);
    console.log(`[room ${room.code}] removed (empty)`);
  }, EMPTY_ROOM_TTL_MS);
}

function sendError(ws: WebSocket, code: ErrorCode, message: string) {
  send(ws, { t: 'error', code, message });
}

function broadcastRoom(room: Room) {
  broadcast(room, {
    t: 'room',
    room: room.code,
    players: [...room.players.values()].map(({ id, name, slot, cam, mic }) => ({ id, name, slot, cam, mic })),
  });
}

function freeSlot(room: Room): number {
  const used = new Set([...room.players.values()].map((p) => p.slot));
  let slot = 0;
  while (used.has(slot)) slot++;
  return slot;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const numOrNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** A phone or host timestamp in server time, or the receive time if its clock sync looks wrong. */
function eventTime(ts: unknown, window: { before: number; after: number; fallbackLag: number }): number {
  const now = Date.now();
  const t = num(ts);
  return t >= now - window.before && t <= now + window.after ? t : now - window.fallbackLag;
}

/** Copies only the known fields, as numbers and booleans, so bad input can't reach the hosts. */
function sanitizeFeatures(m: FeaturesPacket): FeaturesPacket | null {
  const { face, voice, hr } = m;
  if (!face || typeof face !== 'object' || !voice || typeof voice !== 'object') return null;
  return {
    ts: num(m.ts),
    fps: num(m.fps),
    face: {
      present: Boolean(face.present),
      blinkPm: num(face.blinkPm),
      blinkCount: num(face.blinkCount),
      lipPress: num(face.lipPress),
      brow: num(face.brow),
      gazeOff: num(face.gazeOff),
      headMotion: num(face.headMotion),
      speaking: Boolean(face.speaking),
    },
    voice: { pitchHz: numOrNull(voice.pitchHz), clarity: num(voice.clarity), vad: Boolean(voice.vad), rms: num(voice.rms) },
    hr: { bpm: numOrNull(hr?.bpm), quality: num(hr?.quality) },
  };
}

/** Stamps the player's slot into a phone's mesh frame and passes it on to the hosts. */
function forwardMesh(conn: Conn, data: RawData) {
  if (conn.role !== 'player') return;
  const frame = Buffer.isBuffer(data) ? Buffer.from(data) : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data);
  if (frame.length !== MESH_BYTES || frame.readInt16LE(0) !== MESH_MAGIC) return;
  frame.writeInt16LE(conn.player.slot, 2);
  sendToHosts(conn.room, frame, { live: true });
}

/** Trims and shortens the name, and adds " 2", " 3"… if someone in the room already has it. */
function uniqueName(room: Room, raw: string): string {
  const base = raw.trim().replace(/\s+/g, ' ').slice(0, MAX_NAME_LENGTH);
  const taken = new Set([...room.players.values()].map((p) => p.name.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base.slice(0, MAX_NAME_LENGTH - 2)} ${n}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

function leave(conn: Conn, ws: WebSocket) {
  if (conn.role === 'host') {
    conn.room.hosts.delete(ws);
    scheduleCleanup(conn.room);
  } else if (conn.role === 'player') {
    conn.room.players.delete(conn.player.id);
    console.log(`[room ${conn.room.code}] ${conn.player.name} left`);
    conn.room.game.onPlayerLeft(conn.player.id);
    broadcastRoom(conn.room);
    scheduleCleanup(conn.room);
  }
}

function handleMessage(ws: WebSocket, conn: Conn, msg: ClientToServer | HostToServer): Conn {
  switch (msg.t) {
    case 'ping':
      send(ws, { t: 'pong', c: msg.c, s: Date.now() });
      return conn;

    case 'host_join': {
      const code = normalizeRoomCode(String(msg.room ?? ''));
      if (!code) {
        sendError(ws, 'bad_room', 'That room code is not valid.');
        return conn;
      }
      leave(conn, ws);
      const room = getRoom(code);
      room.hosts.add(ws);
      send(ws, { t: 'welcome', room: code, playerId: null });
      broadcastRoom(room);
      room.game.syncTo(ws);
      return { role: 'host', room };
    }

    case 'join': {
      const code = normalizeRoomCode(String(msg.room ?? ''));
      if (!code) {
        sendError(ws, 'bad_room', 'That room code is not valid.');
        return conn;
      }
      if (typeof msg.name !== 'string' || !msg.name.trim()) {
        sendError(ws, 'bad_name', 'Enter a name first.');
        return conn;
      }
      leave(conn, ws);
      const room = getRoom(code);
      if (room.players.size >= MAX_PLAYERS) {
        scheduleCleanup(room);
        sendError(ws, 'room_full', `This room already has ${MAX_PLAYERS} players.`);
        return { role: 'none' };
      }
      const player: Player = {
        id: randomUUID(),
        name: uniqueName(room, msg.name),
        slot: freeSlot(room),
        cam: false,
        mic: false,
        ws,
        features: null,
        samples: [],
        speech: [],
      };
      room.players.set(player.id, player);
      console.log(`[room ${code}] ${player.name} joined`);
      send(ws, { t: 'welcome', room: code, playerId: player.id });
      broadcastRoom(room);
      room.game.syncTo(ws);
      return { role: 'player', room, player };
    }

    case 'status':
      if (conn.role === 'player') {
        conn.player.cam = Boolean(msg.cam);
        conn.player.mic = Boolean(msg.mic);
        broadcastRoom(conn.room);
      }
      return conn;

    case 'diag': {
      const who = conn.role === 'player' ? `room ${conn.room.code}] ${conn.player.name}` : 'no room]';
      console.log(`[${who} diag: ${String(msg.msg).slice(0, 500)}`);
      return conn;
    }

    case 'features': {
      if (conn.role !== 'player') return conn;
      const features = sanitizeFeatures(msg);
      if (!features) return conn;
      recordSample(conn.player, features);
      sendToHosts(conn.room, { t: 'pf', id: conn.player.id, ...features }, { live: true });
      return conn;
    }

    case 'speech_onset':
    case 'speech_end': {
      if (conn.role !== 'player') return conn;
      const event = { at: eventTime(msg.ts, SPEECH_WINDOW), on: msg.t === 'speech_onset' };
      recordSpeech(conn.player, event);
      sendToHosts(conn.room, { t: 'speech', id: conn.player.id, on: event.on, ts: event.at });
      conn.room.game.onSpeech(conn.player, event.on, event.at);
      return conn;
    }

    case 'transcript':
      if (conn.role === 'player') conn.room.game.onTranscript(conn.player, msg);
      return conn;

    case 'done':
      if (conn.role === 'player') conn.room.game.onDone(conn.player, String(msg.turnId));
      return conn;

    case 'start_round':
      if (conn.role === 'host') {
        const error = conn.room.game.start();
        if (error) sendError(ws, 'not_ready', error);
      }
      return conn;

    case 'end_round':
      if (conn.role === 'host') conn.room.game.end();
      return conn;

    case 'tts_end':
      if (conn.role === 'host') conn.room.game.onTtsEnd(String(msg.lineId), eventTime(msg.at, LINE_END_WINDOW));
      return conn;

    default:
      return conn;
  }
}

export function createSocketServer() {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  const alive = new WeakMap<WebSocket, boolean>();

  wss.on('connection', (ws: WebSocket) => {
    let conn: Conn = { role: 'none' };
    alive.set(ws, true);
    ws.on('pong', () => alive.set(ws, true));

    ws.on('message', (data: RawData, isBinary: boolean) => {
      if (isBinary) return forwardMesh(conn, data);
      let msg: ClientToServer | HostToServer;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return sendError(ws, 'bad_message', 'Could not parse message.');
      }
      if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
      conn = handleMessage(ws, conn, msg);
    });

    ws.on('close', () => leave(conn, ws));
    ws.on('error', (err) => console.warn('[ws] error:', err.message));
  });

  // Drop sockets that stop answering pings (a phone that locked or lost signal).
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.get(ws)) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      ws.ping();
    }
  }, HEARTBEAT_MS);
  wss.on('close', () => clearInterval(heartbeat));

  return {
    wss,
    handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    },
  };
}
