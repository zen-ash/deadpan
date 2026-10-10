// The detective's voice and sound effects, from ElevenLabs.
// - Canned lines (intro, questions, fallbacks) are generated once and cached in audio-cache/.
// - Dynamic lines (Gemini's follow-ups and verdicts) stream from eleven_v4_turbo; the big screen
//   starts playing while the rest is still arriving.
// - Sound effects are generated once and cached.
// Everything has a timeout. If ElevenLabs is unavailable the big screen reads lines with the
// laptop's own voice instead, so a round always finishes.
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SFX_NAMES, type SfxName, type SpokenLine } from '@deadpan/shared';
import type { Request, Response } from 'express';

const MODEL = 'eleven_v4_turbo';
const OUTPUT_FORMAT = 'mp3_44100_128';
/** 128 kbps constant bit rate: 16 bytes of MP3 per millisecond. */
const BYTES_PER_MS = 16;
const FIRST_BYTE_TIMEOUT_MS = 2500;
const LINE_TIMEOUT_MS = 20_000;
const SFX_TIMEOUT_MS = 30_000;
const DYNAMIC_TTL_MS = 30 * 60_000;

const CACHE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../audio-cache');

export const SFX: Record<SfxName, { prompt: string; seconds: number }> = {
  drumroll: { prompt: 'tense snare drum roll building suspense, ending on a cymbal crash', seconds: 3.5 },
  stinger: { prompt: 'dramatic orchestral stinger, low brass hit, film noir reveal', seconds: 2 },
  roomtone: { prompt: 'film noir detective office at night, soft rain on the window, distant city hum, seamless loop', seconds: 20 },
  caseclosed: { prompt: 'heavy rubber stamp slammed onto paper on a wooden desk, single thud', seconds: 1 },
};

/** A line ready to play, plus how long it should take (for the round's timeouts). */
export interface Line extends SpokenLine {
  expectedMs: number;
}

const apiKey = () => process.env.ELEVENLABS_API_KEY?.trim() || null;
const voiceId = () => process.env.ELEVENLABS_VOICE_ID?.trim() || null;

/** Subtitle text: audio tags like [whispers] removed. */
export function displayText(tts: string): string {
  return tts
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.!?…])/g, '$1')
    .trim();
}

/** Rough spoken length: ~0.42 s a word, plus a beat for each [pause]. */
function estimateMs(tts: string): number {
  const words = displayText(tts).split(/\s+/).filter(Boolean).length;
  const pauses = (tts.match(/\[(short |long )?pause\]/gi) ?? []).length;
  return Math.max(1200, words * 420 + pauses * 900);
}

// Canned lines

const cannedText = new Map<string, string>();

function cannedId(tts: string): string {
  return `c${createHash('sha1').update(`${voiceId()}|${MODEL}|${tts}`).digest('hex').slice(0, 16)}`;
}

const lineFile = (id: string) => resolve(CACHE_DIR, 'lines', `${id}.mp3`);

/** A pre-generated line. Plays from the cache once prewarm() has made it. */
export function canned(tts: string): Line {
  const id = cannedId(tts);
  cannedText.set(id, tts);
  const file = lineFile(id);
  const expectedMs = existsSync(file) ? statSync(file).size / BYTES_PER_MS : estimateMs(tts);
  return { id, url: `/api/line/${id}.mp3`, text: displayText(tts), expectedMs };
}

// Dynamic lines

interface LineStream {
  chunks: Buffer[];
  done: boolean;
  failed: boolean;
  listeners: Set<() => void>;
  createdAt: number;
}

const streams = new Map<string, LineStream>();

/** Starts streaming speech from ElevenLabs into memory. Resolves once audio is flowing, or false. */
function startStream(id: string, tts: string, onComplete?: (audio: Buffer) => void): Promise<boolean> {
  const key = apiKey();
  const voice = voiceId();
  if (!key || !voice) return Promise.resolve(false);

  const stream: LineStream = { chunks: [], done: false, failed: false, listeners: new Set(), createdAt: Date.now() };
  streams.set(id, stream);
  const notify = () => {
    for (const fn of stream.listeners) fn();
  };

  return new Promise((resolveStarted) => {
    let started = false;
    const controller = new AbortController();
    const firstByte = setTimeout(() => {
      if (!started) controller.abort();
    }, FIRST_BYTE_TIMEOUT_MS);
    const total = setTimeout(() => controller.abort(), LINE_TIMEOUT_MS);

    void (async () => {
      try {
        const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}/stream?output_format=${OUTPUT_FORMAT}`, {
          method: 'POST',
          headers: { 'xi-api-key': key, 'content-type': 'application/json', accept: 'audio/mpeg' },
          body: JSON.stringify({ text: tts, model_id: MODEL }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          stream.chunks.push(Buffer.from(value));
          if (!started) {
            started = true;
            clearTimeout(firstByte);
            resolveStarted(true);
          }
          notify();
        }
        stream.done = true;
        onComplete?.(Buffer.concat(stream.chunks));
      } catch (err) {
        stream.failed = true;
        console.warn(`[tts] "${displayText(tts).slice(0, 40)}" failed:`, err instanceof Error ? err.message : err);
      } finally {
        clearTimeout(firstByte);
        clearTimeout(total);
        stream.done = true;
        if (!started) {
          streams.delete(id);
          resolveStarted(false);
        }
        notify();
      }
    })();
  });
}

/**
 * Speech for text written on the fly (Gemini's lines). Resolves once audio is flowing, or null
 * if ElevenLabs is unavailable, so the caller can switch to a canned line.
 */
export async function dynamic(tts: string): Promise<Line | null> {
  for (const [id, s] of streams) if (Date.now() - s.createdAt > DYNAMIC_TTL_MS) streams.delete(id);
  const id = `d${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const ok = await startStream(id, tts);
  return ok ? { id, url: `/api/line/${id}.mp3`, text: displayText(tts), expectedMs: estimateMs(tts) } : null;
}

/** GET /api/line/:file — a cached canned line, or a dynamic line as it streams in. */
export async function serveLine(req: Request, res: Response) {
  const id = String(req.params.file ?? '').replace(/\.mp3$/, '');
  res.setHeader('Content-Type', 'audio/mpeg');

  if (id.startsWith('c')) {
    if (existsSync(lineFile(id))) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.sendFile(lineFile(id));
      return;
    }
    // Not cached yet (a fresh deploy or a new voice): stream it now and keep it for next time.
    const tts = cannedText.get(id);
    if (!tts || (!streams.has(id) && !(await startStream(id, tts, (audio) => saveFile(lineFile(id), audio))))) {
      res.status(503).end();
      return;
    }
  }

  const stream = streams.get(id);
  if (!stream) {
    res.status(404).end();
    return;
  }
  res.setHeader('Cache-Control', 'no-store');
  let sent = 0;
  const pump = () => {
    while (sent < stream.chunks.length) res.write(stream.chunks[sent++]);
    if (stream.done) {
      stream.listeners.delete(pump);
      res.end();
    }
  };
  stream.listeners.add(pump);
  req.on('close', () => stream.listeners.delete(pump));
  pump();
}

// Sound effects

const sfxFile = (name: SfxName) => resolve(CACHE_DIR, 'sfx', `${name}.mp3`);

/** GET /api/sfx/:file */
export function serveSfx(req: Request, res: Response) {
  const name = String(req.params.file ?? '').replace(/\.mp3$/, '') as SfxName;
  if (!SFX_NAMES.includes(name) || !existsSync(sfxFile(name))) {
    res.status(404).end();
    return;
  }
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.type('audio/mpeg').sendFile(sfxFile(name));
}

async function generateSfx(name: SfxName): Promise<void> {
  const key = apiKey();
  if (!key) return;
  const { prompt, seconds } = SFX[name];
  const res = await fetch(`https://api.elevenlabs.io/v1/sound-generation?output_format=${OUTPUT_FORMAT}`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'content-type': 'application/json' },
    body: JSON.stringify({ text: prompt, duration_seconds: seconds, prompt_influence: 0.6 }),
    signal: AbortSignal.timeout(SFX_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
  saveFile(sfxFile(name), Buffer.from(await res.arrayBuffer()));
}

async function generateLine(tts: string): Promise<void> {
  const id = cannedId(tts);
  const ok = await startStream(id, tts, (audio) => saveFile(lineFile(id), audio));
  if (!ok) throw new Error('no audio');
  // Wait for the rest of the stream (saveFile runs on completion).
  const stream = streams.get(id);
  if (stream && !stream.done) await new Promise<void>((r) => stream.listeners.add(() => stream.done && r()));
  streams.delete(id);
}

function saveFile(file: string, audio: Buffer) {
  if (audio.length === 0) return;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, audio);
}

/**
 * Makes sure every canned line and sound effect is in the cache. Runs in the background at
 * startup; anything still missing during a round streams on demand or falls back.
 */
export async function prewarm(lines: string[]): Promise<void> {
  if (!apiKey() || !voiceId()) {
    console.warn('[audio] ELEVENLABS_API_KEY or ELEVENLABS_VOICE_ID missing: the big screen will use the laptop voice');
    return;
  }
  let made = 0;
  for (const name of SFX_NAMES) {
    if (existsSync(sfxFile(name))) continue;
    try {
      await generateSfx(name);
      made++;
    } catch (err) {
      console.warn(`[audio] sound effect ${name} failed:`, err instanceof Error ? err.message : err);
    }
  }
  for (const tts of new Set(lines)) {
    if (existsSync(lineFile(canned(tts).id))) continue;
    try {
      await generateLine(tts);
      made++;
    } catch (err) {
      console.warn(`[audio] line "${displayText(tts).slice(0, 40)}" failed:`, err instanceof Error ? err.message : err);
    }
  }
  if (made > 0) console.log(`[audio] generated ${made} cached clips`);
}

/** Duration of a cached sound effect, for pacing the verdict. */
export function sfxMs(name: SfxName): number {
  return existsSync(sfxFile(name)) ? statSync(sfxFile(name)).size / BYTES_PER_MS : SFX[name].seconds * 1000;
}
