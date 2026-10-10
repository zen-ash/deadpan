// Records one round in memory and writes it to rounds/<room>-<round>.json when it ends (SPEC:
// no database). The evidence board and demo mode read these files. Gemini's dynamic voice lines
// are copied next to them, so a replay can play them after the in-memory audio has expired.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  AnswerResult,
  FeaturesPacket,
  RoundFile,
  RoundSample,
  SfxName,
  SpokenLine,
  TranscriptWord,
  TurnInfo,
  Verdict,
} from '@deadpan/shared';
import { dynamicAudio } from './audio';

export const ROUNDS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../rounds');
const MESH_EVERY_MS = 200;

export function roundFilePath(room: string, round: number): string {
  return resolve(ROUNDS_DIR, `${room}-${round}.json`);
}

export function roundAudioPath(id: string): string {
  return resolve(ROUNDS_DIR, 'audio', `${id}.mp3`);
}

export class RoundRecorder {
  private readonly data: RoundFile;
  private readonly lastMeshAt = new Map<string, number>();
  /** Set once the round is saved; anything after that isn't part of it. */
  private closed = false;

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
    ];
    this.data.samples[playerId]?.push(sample);
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
    this.data.turns.push({ id: info.id, kind: info.kind, playerId: info.playerId, question: info.text, askedAt: Date.now(), questionEnd: null, answerEnd: null });
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
      mkdirSync(resolve(ROUNDS_DIR, 'audio'), { recursive: true });
      for (const line of this.data.lines) {
        const base = line.id.split('~')[0]!;
        if (!base.startsWith('d')) continue;
        const audio = dynamicAudio(base);
        if (!audio) continue;
        if (!existsSync(roundAudioPath(base))) writeFileSync(roundAudioPath(base), audio);
        line.url = `/api/rounds/audio/${base}.mp3`;
      }
      const file = roundFilePath(this.data.room, this.data.round);
      writeFileSync(file, JSON.stringify(this.data));
      return file;
    } catch (err) {
      console.warn('[rounds] could not save the round:', err instanceof Error ? err.message : err);
      return null;
    }
  }
}

const round4 = (v: number) => Math.round(v * 10_000) / 10_000;
