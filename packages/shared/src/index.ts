// Message types and game constants shared by the web app and the server.

export const WS_PATH = '/ws';
export const MAX_PLAYERS = 6;
export const MAX_NAME_LENGTH = 16;
export const FEATURE_HZ = 10;

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
  cam: boolean;
  mic: boolean;
}

export interface FaceFeatures {
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

export type ClientToServer =
  | { t: 'join'; room: string; name: string }
  | { t: 'status'; cam: boolean; mic: boolean }
  | { t: 'diag'; msg: string }
  | { t: 'ping'; c: number }
  | { t: 'features'; ts: number; face: FaceFeatures; voice: VoiceFeatures; hr: { bpm: number | null; quality: number } }
  | { t: 'mesh'; ts: number; pts: Int16Array }
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
  | { t: 'turn_over' };
