// Records one round in memory and writes it to rounds/<room>-<round>.json when it ends (SPEC:
// no database). The evidence board and demo mode read these files. Gemini's dynamic voice lines
// are copied next to them, so a replay can play them after the in-memory audio has expired.
// ROUNDS_DIR moves the folder, e.g. onto Render's persistent disk so rounds survive deploys.
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  AnswerResult,
  FeaturesPacket,
  RoundEvent,
  RoundFile,
  RoundLogEntry,
  RoundSample,
  RoundSummary,
  SfxName,
  SpokenLine,
  TranscriptWord,
  TurnInfo,
  Verdict,
} from '@deadpan/shared';
import { dynamicAudio } from './audio';

const DEFAULT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../rounds');
/**
 * Rounds committed to the repo for demo mode (the landing page links one). They ship with every
 * deploy, unlike the rounds folder, and are only read, after the rounds folder.
 */
const DEMO_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../demo');
const MESH_EVERY_MS = 200;

/** Read when used, not at import, so a ROUNDS_DIR from .env (loaded after imports) still applies. */
export function roundsDir(): string {
  return process.env.ROUNDS_DIR ? resolve(process.env.ROUNDS_DIR) : DEFAULT_DIR;
}

export function roundFilePath(room: string, round: number): string {
  return resolve(roundsDir(), `${room}-${round}.json`);
}

export function roundAudioPath(id: string): string {
  return resolve(roundsDir(), 'audio', `${id}.mp3`);
}

/** A saved round's file: from the rounds folder, or else a committed demo round. */
export function findRoundFile(room: string, round: number): string | null {
  for (const dir of [roundsDir(), DEMO_DIR]) {
    const file = resolve(dir, `${room}-${round}.json`);
    if (existsSync(file)) return file;
  }
  return null;
}

/** A recorded Gemini line, from the rounds folder or a committed demo round. */
export function findRoundAudio(id: string): string | null {
  for (const dir of [roundsDir(), DEMO_DIR]) {
    const file = resolve(dir, 'audio', `${id}.mp3`);
    if (existsSync(file)) return file;
  }
  return null;
}

/** Every finished round, one JSON line each, for the accuracy stat. */
function roundLogPath(): string {
  return resolve(roundsDir(), 'rounds.jsonl');
}

export function logRound(entry: RoundLogEntry) {
  try {
    mkdirSync(roundsDir(), { recursive: true });
    appendFileSync(roundLogPath(), `${JSON.stringify(entry)}\n`);
  } catch (err) {
    console.warn('[rounds] could not log the round:', err instanceof Error ? err.message : err);
  }
}

export function readRoundLog(): RoundLogEntry[] {
  try {
    return readFileSync(roundLogPath(), 'utf8')
      .split('\n')
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as RoundLogEntry];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

/**
 * The highest round saved for this room code. A room starts counting from here, so reusing a code
 * after its room was cleared never overwrites an older recording.
 */
export function lastSavedRound(room: string): number {
  let last = 0;
  // A demo round's code counts too, so a live room that happens to share it can't shadow it.
  for (const dir of [roundsDir(), DEMO_DIR]) {
    try {
      for (const file of readdirSync(dir)) {
        const m = file.match(/^([A-Z]{4})-(\d+)\.json$/);
        if (m?.[1] === room) last = Math.max(last, Number(m[2]));
      }
    } catch {
      // No such folder yet.
    }
  }
  return last;
}

/** Round files already read for the list, by name, until they change. */
const summaries = new Map<string, { mtimeMs: number; summary: RoundSummary | null }>();

/** Saved rounds, newest first: one room's, or every room's. Each file is read once. */
export function listRounds(room?: string): RoundSummary[] {
  let files: string[];
  try {
    files = readdirSync(roundsDir()).filter((f) => /^[A-Z]{4}-\d+\.json$/.test(f) && (!room || f.startsWith(`${room}-`)));
  } catch {
    return [];
  }
  const out: RoundSummary[] = [];
  for (const file of files) {
    const path = resolve(roundsDir(), file);
    let mtimeMs: number;
    try {
      mtimeMs = statSync(path).mtimeMs;
    } catch {
      continue;
    }
    let cached = summaries.get(file);
    if (cached?.mtimeMs !== mtimeMs) {
      cached = { mtimeMs, summary: summarize(path) };
      summaries.set(file, cached);
    }
    if (cached.summary) out.push(cached.summary);
  }
  return out.sort((a, b) => b.startedAt - a.startedAt);
}

/** The list entry for a round file, or null if it can't be read. */
function summarize(path: string): RoundSummary | null {
  try {
    const r = JSON.parse(readFileSync(path, 'utf8')) as RoundFile;
    return {
      room: r.room,
      round: r.round,
      startedAt: r.startedAt,
      endedAt: r.endedAt,
      players: r.players.map((p) => p.name),
      word: r.word,
      caught: r.verdict ? r.verdict.correct : null,
      replayable: !!r.events?.length,
    };
  } catch {
    return null;
  }
}

export class RoundRecorder {
  private readonly data: RoundFile;
  private readonly lastMeshAt = new Map<string, number>();
  /** Set once the round is saved; anything after that isn't part of it. */
  private closed = false;
  /** The file is written, so the recording is complete. */
  saved = false;

  constructor(room: string, round: number, players: { id: string; name: string; slot: number }[]) {
    this.data = {
      version: 1,
      room,
      round,
      startedAt: Date.now(),
      endedAt: 0,
      word: null,
      imposterId: null,
      players,
      turns: [],
      answers: [],
      transcripts: [],
      samples: Object.fromEntries(players.map((p) => [p.id, []])),
      speech: Object.fromEntries(players.map((p) => [p.id, []])),
      meshes: Object.fromEntries(players.map((p) => [p.id, []])),
      lines: [],
      sfx: [],
      verdict: null,
      events: [],
    };
  }

  get round() {
    return this.data.round;
  }

  sample(playerId: string, f: FeaturesPacket) {
    if (this.closed) return;
    const sample: RoundSample = [
      Date.now(),
      f.voice.pitchHz ?? -1,
      round4(f.voice.rms),
      f.face.blinkCount,
      round4(f.face.lipPress),
      round4(f.face.brow),
      round4(f.face.gazeOff),
      round4(f.face.headMotion),
      f.hr.bpm ?? -1,
      round4(f.hr.quality),
      f.face.present ? 1 : 0,
      f.voice.vad ? 1 : 0,
      round4(f.face.blinkPm),
      round4(f.fps),
    ];
    this.data.samples[playerId]?.push(sample);
  }

  /** A game message to the big screen, copied as it was at this moment (turn info changes later). */
  event(msg: RoundEvent) {
    if (this.closed) return;
    this.data.events!.push([Date.now(), structuredClone(msg)]);
  }

  speech(playerId: string, on: boolean, at: number) {
    if (this.closed) return;
    this.data.speech[playerId]?.push([at, on ? 1 : 0]);
  }

  /** Keeps every other mesh frame or so (5 Hz), which is plenty for a replay. */
  mesh(playerId: string, frame: Buffer) {
    if (this.closed) return;
    const now = Date.now();
    if (now - (this.lastMeshAt.get(playerId) ?? 0) < MESH_EVERY_MS) return;
    this.lastMeshAt.set(playerId, now);
    this.data.meshes[playerId]?.push([now, frame.toString('base64')]);
  }

  secret(word: string, imposterId: string) {
    this.data.word = word;
    this.data.imposterId = imposterId;
  }

  turnStarted(info: TurnInfo) {
    this.data.turns.push({
      id: info.id,
      kind: info.kind,
      playerId: info.playerId,
      question: info.text,
      askedAt: Date.now(),
      questionEnd: null,
      answerEnd: null,
    });
  }

  turnTimes(turnId: string, times: { questionEnd?: number; answerEnd?: number }) {
    const turn = this.data.turns.find((t) => t.id === turnId);
    if (turn) Object.assign(turn, times);
  }

  answer(result: AnswerResult) {
    this.data.answers.push(result);
  }

  transcript(turnId: string, playerId: string, text: string, words: TranscriptWord[]) {
    this.data.transcripts = this.data.transcripts.filter((t) => t.turnId !== turnId);
    this.data.transcripts.push({ turnId, playerId, text, words });
  }

  line(line: SpokenLine) {
    this.data.lines.push({ ...line, at: Date.now() });
  }

  sfx(name: SfxName) {
    this.data.sfx.push({ name, at: Date.now() });
  }

  verdict(verdict: Verdict) {
    this.data.verdict = verdict;
  }

  /** The round as it stands, e.g. for the evidence board before the file is written. */
  snapshot(): RoundFile {
    return { ...this.data, endedAt: this.data.endedAt || Date.now() };
  }

  /** Writes the round file, plus any Gemini voice lines that only exist in memory. */
  save(): string | null {
    this.closed = true;
    this.data.endedAt = Date.now();
    try {
      mkdirSync(resolve(roundsDir(), 'audio'), { recursive: true });
      const spoken = this.data.events!.flatMap(([, e]) => (e.t === 'say' ? [e.line] : []));
      for (const line of [...this.data.lines, ...spoken]) {
        const base = line.id.split('~')[0]!;
        if (!base.startsWith('d')) continue;
        const audio = dynamicAudio(base);
        if (!audio) continue;
        if (!existsSync(roundAudioPath(base))) writeFileSync(roundAudioPath(base), audio);
        line.url = `/api/rounds/audio/${base}.mp3`;
      }
      let file = roundFilePath(this.data.room, this.data.round);
      // Never overwrite an older recording; keep this one beside it instead.
      if (existsSync(file)) {
        file = file.replace(/\.json$/, `-${Date.now()}.json`);
        console.warn(`[rounds] ${this.data.room}-${this.data.round}.json already exists`);
      }
      writeFileSync(file, JSON.stringify(this.data), { flag: 'wx' });
      this.saved = true;
      return file;
    } catch (err) {
      console.warn('[rounds] could not save the round:', err instanceof Error ? err.message : err);
      return null;
    }
  }
}

const round4 = (v: number) => Math.round(v * 10_000) / 10_000;
