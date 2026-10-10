// Message types and game constants shared by the web app and the server.

export { MESH_EDGES, MESH_POINTS } from './mesh';

export const WS_PATH = '/ws';
export const MAX_PLAYERS = 6;
export const MAX_NAME_LENGTH = 16;
export const FEATURE_HZ = 10;

/**
 * Face mesh frames travel as binary WebSocket messages: an Int16Array of
 * [MESH_MAGIC, slot, x0, y0, z0, x1, y1, z1, …] for the landmarks in MESH_POINTS. Coordinates
 * are centred on the face and scaled by its size, then multiplied by MESH_QUANT. Phones send
 * slot 0 and the server fills in the player's slot before forwarding to the big screen.
 */
export const MESH_MAGIC = 0x4d31;
export const MESH_HEADER = 2;
export const MESH_QUANT = 16384;

// No I or O, so codes read cleanly off a screen.
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
export const ROOM_CODE_LENGTH = 4;

export function makeRoomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(ROOM_CODE_LENGTH));
  return Array.from(bytes, (b) => ROOM_CODE_ALPHABET[b % ROOM_CODE_ALPHABET.length]).join('');
}

/** Returns the canonical room code, or null if `raw` isn't a valid one. */
export function normalizeRoomCode(raw: string): string | null {
  const code = raw.trim().toUpperCase();
  if (code.length !== ROOM_CODE_LENGTH) return null;
  for (const ch of code) if (!ROOM_CODE_ALPHABET.includes(ch)) return null;
  return code;
}

export type Phase = 'lobby' | 'baseline' | 'deal' | 'question' | 'answer' | 'followup' | 'verdict' | 'replay';

export interface PlayerInfo {
  id: string;
  name: string;
  /** 0–5, stable while the player is in the room. Identifies their binary mesh frames. */
  slot: number;
  cam: boolean;
  mic: boolean;
}

export interface FaceFeatures {
  /** False when no face is in view; the other values then hold their last readings. */
  present: boolean;
  blinkPm: number;
  lipPress: number;
  brow: number;
  gazeOff: number;
  headMotion: number;
  speaking: boolean;
}

export interface VoiceFeatures {
  pitchHz: number | null;
  clarity: number;
  vad: boolean;
  rms: number;
}

export interface FeaturesPacket {
  ts: number;
  /** Face tracking frames per second on the phone. */
  fps: number;
  face: FaceFeatures;
  voice: VoiceFeatures;
  hr: { bpm: number | null; quality: number };
}

export type ClientToServer =
  | { t: 'join'; room: string; name: string }
  | { t: 'status'; cam: boolean; mic: boolean }
  | { t: 'diag'; msg: string }
  | { t: 'ping'; c: number }
  | ({ t: 'features' } & FeaturesPacket)
  | { t: 'speech_onset'; ts: number }
  | { t: 'speech_end'; ts: number }
  | { t: 'transcript'; final: boolean; words: { w: string; start: number; end: number }[] }
  | { t: 'done' };

export type HostToServer =
  | { t: 'host_join'; room: string }
  | { t: 'tts_end'; lineId: string }
  | { t: 'start_round' };

export type ErrorCode = 'bad_room' | 'bad_name' | 'room_full' | 'bad_message';

export type ServerToClient =
  | { t: 'welcome'; room: string; playerId: string | null }
  | { t: 'room'; room: string; phase: Phase; players: PlayerInfo[] }
  | { t: 'error'; code: ErrorCode; message: string }
  | { t: 'pong'; c: number; s: number }
  | { t: 'state'; phase: Phase; round: number; activePlayer?: string }
  | { t: 'secret'; word: string | null } // null = imposter
  | { t: 'your_turn'; questionEnd: number; scribeToken: string }
  | { t: 'turn_over' }
  // To hosts only: a player's latest features, and their speech onsets and ends.
  | ({ t: 'pf'; id: string } & FeaturesPacket)
  | { t: 'speech'; id: string; on: boolean; ts: number };
