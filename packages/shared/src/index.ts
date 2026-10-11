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

/**
 * While the big screen's camera view is open, phones also send every landmark (FACE_LANDMARK_COUNT
 * in @deadpan/shared/face) where it sits in the camera frame: [CV_MAGIC, slot, x0, y0, z0, …], with
 * x and y as fractions of the frame's width and height and z on x's scale, times CV_QUANT.
 */
export const CV_MAGIC = 0x4d32;
export const CV_QUANT = 30000;

/** Skin patches the camera heart rate is read from: above the brows, and the middle of each cheek. */
export const PULSE_REGIONS: readonly (readonly number[])[] = [
  [151, 108, 337, 107, 336, 9],
  [50, 101, 118, 117, 123, 187, 205, 36],
  [280, 330, 347, 346, 352, 411, 425, 266],
];

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

export type Phase = 'lobby' | 'baseline' | 'deal' | 'question' | 'followup' | 'verdict' | 'replay';

// Turn timing: an answer ends on "done", after a stretch of silence, or at a 15 s cap.
export const ANSWER_CAP_MS = 15_000;
/**
 * SPEC said 2.5 s, but in playtests half the answers that ended on silence were people pausing to
 * think (2.6–5.4 s) who then kept talking, and a long pause is just what the detective wants to hear.
 */
export const SILENCE_END_MS = 6_000;
/** Speech this soon after the question ends is the question's echo, not an answer. */
export const MIN_RESPONSE_MS = 200;
export const DEAL_MS = 6_000;

export interface PlayerInfo {
  id: string;
  name: string;
  /** 0–5, stable while the player is in the room. Identifies their binary mesh frames. */
  slot: number;
  cam: boolean;
  mic: boolean;
  /** False while the phone is disconnected; it keeps its place for a while in case it comes back. */
  online: boolean;
}

export interface FaceFeatures {
  /** False when no face is in view; the other values then hold their last readings. */
  present: boolean;
  blinkPm: number;
  /** Blinks counted since tracking started, so the server can count blinks within an answer. */
  blinkCount: number;
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

/** How the phone's vision pipeline is doing, for the big screen's camera view. */
export interface VisionStats {
  /** Face tracking time per frame, in ms. */
  inferMs: number;
  gpu: boolean;
  /** Camera frame size in pixels. */
  frameW: number;
  frameH: number;
  /** Eye aspect ratio: the lowest in the last 100 ms (so blinks show), and this player's open-eye level. */
  ear: number;
  earOpen: number;
  /** The blink detector sees the eyes shut right now. */
  eyesClosed: boolean;
  /** Length of the latest blink, in ms (0 before the first). */
  lastBlinkMs: number;
  /** Share of the last 30 s with the eyes shut (PERCLOS, the usual drowsiness measure), 0–1. */
  perclos: number;
  /** Head pose in degrees: turn, nod (positive is up) and tilt. */
  yaw: number;
  pitch: number;
  roll: number;
  /** The speech detector: Silero's neural VAD, or the loudness fallback. */
  vad: 'silero' | 'rms' | 'loading';
}

export interface FeaturesPacket {
  ts: number;
  /** Face tracking frames per second on the phone. */
  fps: number;
  face: FaceFeatures;
  voice: VoiceFeatures;
  hr: { bpm: number | null; quality: number };
  /** Missing until the face tracker has loaded. */
  vision?: VisionStats;
}

export type TurnKind = 'baseline' | 'question' | 'followup';
/** asking: the detective's line is playing. answering: the player's answer is being timed. */
export type TurnStage = 'asking' | 'answering' | 'scoring';

export interface TurnInfo {
  /** Also the line id the host reports back in tts_end. */
  id: string;
  kind: TurnKind;
  playerId: string;
  /** The detective's line, shown as subtitles. */
  text: string;
  stage: TurnStage;
  /** 1-based position of this turn within its phase, and the phase's turn count. */
  index: number;
  total: number;
  /** Server time the line finished playing, once the answer has started. */
  questionEnd: number | null;
  /** Server time the answer is cut off at the latest. */
  answerDeadline: number | null;
}

/** deliberating: drumroll while the detective decides. accusing: the verdict is spoken. revealed: the truth is out. */
export type VerdictStage = 'deliberating' | 'accusing' | 'revealed';

export interface GameState {
  phase: Phase;
  round: number;
  /** Players in this round. Anyone who joins mid-round waits for the next one. */
  roundPlayers: string[];
  turn: TurnInfo | null;
  /** Server time the deal phase ends. */
  dealEndsAt: number | null;
  verdictStage: VerdictStage | null;
}

/** Something the detective says, played by the big screen. */
export interface SpokenLine {
  id: string;
  /** Streams the audio (ElevenLabs v4, or a cached canned line). */
  url: string;
  /** Subtitle text, with audio tags like [whispers] removed. */
  text: string;
}

export type SfxName = 'drumroll' | 'stinger' | 'roomtone' | 'caseclosed';
export const SFX_NAMES: readonly SfxName[] = ['drumroll', 'stinger', 'roomtone', 'caseclosed'];

/** A word from Scribe, with start and end in server time (ms). */
export interface TranscriptWord {
  w: string;
  start: number;
  end: number;
}

export interface AnswerMetrics {
  /** Question end to first speech onset. */
  rtMs: number | null;
  durationMs: number;
  words: number;
  transcript: string;
  pauseCount: number | null;
  pauseMs: number | null;
  wordsPerSec: number | null;
  fillers: number | null;
  pitchHz: number | null;
  /** Median pitch against the player's baseline, in semitones. */
  pitchShiftSt: number | null;
  blinkPm: number | null;
  lipPress: number | null;
}

/** z-scores against the player's own baseline; positive means further from calm. */
export interface AnswerZ {
  rt: number | null;
  pitch: number | null;
  /** Pauses, fillers and slower speech combined; this is what the delivery score weighs. */
  hesitation: number | null;
  pauses: number | null;
  fillers: number | null;
  /** Size of the change in blink rate, in either direction. */
  blink: number | null;
  lip: number | null;
}

export interface AnswerResult {
  turnId: string;
  playerId: string;
  kind: TurnKind;
  question: string;
  metrics: AnswerMetrics;
  /** Null for baseline answers, which define calm. */
  z: AnswerZ | null;
  delivery: number | null;
}

export interface PlayerScore {
  playerId: string;
  /** Mean delivery score over the player's answers. */
  delivery: number | null;
  /** 0–1: how little their answers related to the secret word. */
  content: number | null;
  combined: number;
}

export interface Verdict {
  round: number;
  word: string;
  imposterId: string;
  accusedId: string;
  correct: boolean;
  source: 'local' | 'gemini';
  /** 0–1, from Gemini; null for the local fallback. */
  confidence: number | null;
  scores: PlayerScore[];
  evidence: string[];
  /** The spoken accusation, as subtitles. */
  spoken: string;
}

export type ClientToServer =
  // `resume` (from an earlier welcome) takes back the same player after a dropped connection or a reload.
  | { t: 'join'; room: string; name: string; resume?: { id: string; token: string } }
  | { t: 'status'; cam: boolean; mic: boolean }
  | { t: 'diag'; msg: string }
  | { t: 'ping'; c: number }
  | ({ t: 'features' } & FeaturesPacket)
  // Speech onsets and ends, in server time.
  | { t: 'speech_onset'; ts: number }
  | { t: 'speech_end'; ts: number }
  | { t: 'transcript'; turnId: string; final: boolean; text: string; words: TranscriptWord[] }
  | { t: 'done'; turnId: string };

export type HostToServer =
  | { t: 'host_join'; room: string }
  /** `at` is when playback ended, in server time. */
  | { t: 'tts_end'; lineId: string; at: number }
  | { t: 'start_round' }
  /** Back to the lobby: after the verdict, or to abandon a round. */
  | { t: 'end_round' }
  /** The camera view opened or closed; phones send full landmark frames while any host has it open. */
  | { t: 'camera_view'; on: boolean };

export type ErrorCode = 'bad_room' | 'bad_name' | 'room_full' | 'bad_message' | 'not_ready';

export type ServerToClient =
  // Players also get a resume token, kept for the rest of the session.
  | { t: 'welcome'; room: string; playerId: string | null; resume?: string }
  | { t: 'room'; room: string; players: PlayerInfo[] }
  | { t: 'error'; code: ErrorCode; message: string }
  | { t: 'pong'; c: number; s: number }
  | ({ t: 'state' } & GameState)
  | { t: 'secret'; word: string | null } // null = imposter
  // To the active phone. The Scribe socket opens while the question plays, but audio only
  // streams once the answer starts.
  | { t: 'scribe'; turnId: string; url: string }
  | { t: 'your_turn'; turnId: string; questionEnd: number }
  | { t: 'turn_over'; turnId: string }
  // To phones: start or stop sending full landmark frames (CV_MAGIC).
  | { t: 'camera_view'; on: boolean }
  | ({ t: 'verdict' } & Verdict)
  // To hosts only.
  | { t: 'say'; line: SpokenLine }
  | { t: 'sfx'; name: SfxName }
  | ({ t: 'pf'; id: string } & FeaturesPacket)
  | { t: 'speech'; id: string; on: boolean; ts: number }
  | { t: 'live_transcript'; playerId: string; turnId: string; text: string; final: boolean }
  | ({ t: 'answer' } & AnswerResult);

// Round recordings (no database): written to rounds/<room>-<round>.json when a round ends, and
// read back by the evidence board and demo mode. Times are server time in ms.

/**
 * One 10 Hz signal sample: [t, pitchHz or -1, rms, blinkCount, lipPress, brow, gazeOff, headMotion,
 * heart bpm or -1, heart quality, face present (0/1), speaking (0/1), blinks per minute, face fps].
 * The last two are missing from rounds recorded before demo mode.
 */
export type RoundSample = [number, number, number, number, number, number, number, number, number, number, number, number, number?, number?];

/** A saved round, for the "Past rounds" lists. */
export interface RoundSummary {
  room: string;
  round: number;
  startedAt: number;
  endedAt: number;
  players: string[];
  word: string | null;
  /** Whether the detective caught the imposter; null without a verdict. */
  caught: boolean | null;
  /** Recorded with demo mode's event log, so it can be played back (not just shown as evidence). */
  replayable: boolean;
}

/** One line of rounds.jsonl: how a finished round went, for the accuracy stat. */
export interface RoundLogEntry {
  at: number;
  room: string;
  round: number;
  players: number;
  word: string;
  imposter: string;
  accused: string;
  correct: boolean;
  source: 'local' | 'gemini';
  confidence: number | null;
}

/** The private all-rounds page: every saved round, and the accuracy log. */
export interface AdminRounds {
  rounds: RoundSummary[];
  log: RoundLogEntry[];
}

/** The game messages the big screen got during the round, which demo mode plays back in time. */
export type RoundEvent = Extract<ServerToClient, { t: 'state' | 'say' | 'sfx' | 'answer' | 'verdict' | 'live_transcript' }>;

export interface RoundTurn {
  id: string;
  kind: TurnKind;
  playerId: string;
  question: string;
  askedAt: number;
  questionEnd: number | null;
  answerEnd: number | null;
}

export interface RoundLine {
  id: string;
  url: string;
  text: string;
  at: number;
}

export interface RoundFile {
  version: 1;
  room: string;
  round: number;
  startedAt: number;
  endedAt: number;
  word: string | null;
  imposterId: string | null;
  players: { id: string; name: string; slot: number }[];
  turns: RoundTurn[];
  answers: AnswerResult[];
  transcripts: { turnId: string; playerId: string; text: string; words: TranscriptWord[] }[];
  samples: Record<string, RoundSample[]>;
  speech: Record<string, [number, 0 | 1][]>;
  /** Face mesh frames at 5 Hz, as base64 of the binary frame (see MESH_MAGIC). */
  meshes: Record<string, [number, string][]>;
  lines: RoundLine[];
  sfx: { name: SfxName; at: number }[];
  verdict: Verdict | null;
  /** Every game message sent to the big screen, with its server time. Missing before demo mode. */
  events?: [number, RoundEvent][];
}
