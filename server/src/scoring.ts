// Turns a player's signals during an answer into metrics, compares them with that player's
// own calm baseline, and picks a suspect when no AI verdict is available.
import {
  MIN_RESPONSE_MS,
  type AnswerMetrics,
  type AnswerResult,
  type AnswerZ,
  type PlayerScore,
  type TranscriptWord,
  type Verdict,
} from '@deadpan/shared';
import type { Sample, SpeechEvent } from './room';
import { relatedHits, tokens } from './words';

/** SPEC starting weights for the delivery score. Tune these on playtest logs. */
export const WEIGHTS = { rt: 0.3, pitch: 0.2, hesitation: 0.25, blink: 0.15, lip: 0.1 } as const;

const PAUSE_MIN_MS = 300;
const FILLERS = new Set(['um', 'umm', 'uh', 'uhh', 'uhm', 'erm', 'er', 'hmm', 'mm', 'like']);
const Z_LIMIT = 3;

/**
 * Typical answer-to-answer spread for each feature. One or two baseline answers can't give a
 * real standard deviation, so each scale is at least this much.
 */
const MIN_SCALE = { rtMs: 500, pitchSt: 1.5, fillerRate: 0.05, pauseRatio: 0.12, wordsPerSec: 0.6, blinkPm: 15, lip: 0.04 };
/** Population defaults for a feature the baseline didn't capture. */
const PRIOR = { rtMs: 1100, fillerRate: 0.03, pauseRatio: 0.15, wordsPerSec: 2.6, blinkPm: 15, lip: 0.05 };

export interface Window {
  start: number;
  end: number;
}

interface Stat {
  mean: number;
  scale: number;
}

export interface Baseline {
  rt: Stat;
  pitchHz: number | null;
  fillerRate: Stat;
  pauseRatio: Stat;
  wordsPerSec: Stat;
  blink: Stat;
  lip: Stat;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const std = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
};
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? null : s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};
const clampZ = (z: number) => Math.max(-Z_LIMIT, Math.min(Z_LIMIT, z));
const semitones = (hz: number, ref: number) => 12 * Math.log2(hz / ref);

const inWindow = (samples: Sample[], w: Window) => samples.filter((s) => s.at >= w.start && s.at <= w.end);

/** Measures one answer from the player's signal history and Scribe's words. */
export function answerMetrics(
  samples: Sample[],
  speech: SpeechEvent[],
  window: Window,
  words: TranscriptWord[],
  transcript: string,
  baselinePitchHz: number | null,
): AnswerMetrics {
  const durationMs = Math.max(0, window.end - window.start);
  const answerWords = words.filter((w) => w.start >= window.start - 500 && w.start <= window.end + 1500);

  // Response time: the first speech onset that isn't the question's own echo. Scribe's first
  // word stands in when the phone's speech detector missed the start.
  const earliest = window.start + MIN_RESPONSE_MS;
  const onset = speech.find((e) => e.on && e.at >= earliest && e.at <= window.end)?.at;
  const firstWord = answerWords.find((w) => w.start >= earliest)?.start;
  const start = onset ?? firstWord;
  const rtMs = start !== undefined ? start - window.start : null;

  // Pauses: gaps of 300 ms or more between words, or between speech segments without words.
  let pauseCount: number | null = null;
  let pauseMs: number | null = null;
  let wordsPerSec: number | null = null;
  if (answerWords.length >= 2) {
    pauseCount = 0;
    pauseMs = 0;
    for (let i = 1; i < answerWords.length; i++) {
      const gap = answerWords[i]!.start - answerWords[i - 1]!.end;
      if (gap >= PAUSE_MIN_MS) {
        pauseCount++;
        pauseMs += gap;
      }
    }
    const spoken = (answerWords.at(-1)!.end - answerWords[0]!.start) / 1000;
    if (answerWords.length >= 3 && spoken > 0.5) wordsPerSec = answerWords.length / spoken;
  } else {
    const events = speech.filter((e) => e.at >= window.start && e.at <= window.end);
    const gaps: number[] = [];
    for (let i = 1; i < events.length; i++) {
      if (!events[i - 1]!.on && events[i]!.on) gaps.push(events[i]!.at - events[i - 1]!.at);
    }
    if (events.some((e) => e.on)) {
      const long = gaps.filter((g) => g >= PAUSE_MIN_MS);
      pauseCount = long.length;
      pauseMs = long.reduce((a, b) => a + b, 0);
    }
  }

  const text = transcript || answerWords.map((w) => w.w).join(' ');
  const toks = tokens(text);
  let fillers: number | null = null;
  if (text.trim()) {
    fillers = toks.filter((t) => FILLERS.has(t)).length + (text.toLowerCase().match(/\byou know\b/g)?.length ?? 0);
  }

  // Frame-level signals over the answer.
  const frames = inWindow(samples, window);
  const voiced = frames.map((s) => s.f.voice.pitchHz).filter((p): p is number => p !== null);
  const pitchHz = voiced.length >= 3 ? median(voiced) : null;
  const withFace = frames.filter((s) => s.f.face.present);
  const lipPress = withFace.length >= 5 ? mean(withFace.map((s) => s.f.face.lipPress)) : null;
  let blinkPm: number | null = null;
  if (withFace.length >= 5 && durationMs >= 2000) {
    const blinks = withFace.at(-1)!.f.face.blinkCount - withFace[0]!.f.face.blinkCount;
    blinkPm = Math.max(0, blinks) / ((withFace.at(-1)!.at - withFace[0]!.at) / 60_000 || 1);
  }

  return {
    rtMs,
    durationMs,
    words: toks.length,
    transcript: text,
    pauseCount,
    pauseMs,
    wordsPerSec,
    fillers,
    pitchHz,
    pitchShiftSt: pitchHz !== null && baselinePitchHz !== null ? semitones(pitchHz, baselinePitchHz) : null,
    blinkPm,
    lipPress,
  };
}

function fillerRate(m: AnswerMetrics): number | null {
  return m.fillers !== null && m.words > 0 ? m.fillers / m.words : null;
}

function pauseRatio(m: AnswerMetrics): number | null {
  return m.pauseMs !== null && m.durationMs > 0 ? m.pauseMs / m.durationMs : null;
}

function stat(values: (number | null)[], prior: number, minScale: number): Stat {
  const xs = values.filter((v): v is number => v !== null);
  return { mean: xs.length > 0 ? mean(xs) : prior, scale: Math.max(std(xs), minScale) };
}

/**
 * A player's calm baseline from their softball answers. Blink rate and pitch also use the
 * minute of lobby time before the deal, since a few seconds of answer is too short for them.
 */
export function buildBaseline(answers: AnswerMetrics[], samples: Sample[], windows: Window[], until: number): Baseline {
  const answerFrames = windows.flatMap((w) => inWindow(samples, w));
  const recent = samples.filter((s) => s.at >= until - 60_000 && s.at <= until);

  let voiced = answerFrames.map((s) => s.f.voice.pitchHz).filter((p): p is number => p !== null);
  if (voiced.length < 5) voiced = recent.map((s) => s.f.voice.pitchHz).filter((p): p is number => p !== null);

  const faces = recent.filter((s) => s.f.face.present);
  const lips = (answerFrames.some((s) => s.f.face.present) ? answerFrames : recent)
    .filter((s) => s.f.face.present)
    .map((s) => s.f.face.lipPress);

  return {
    rt: stat(answers.map((a) => a.rtMs), PRIOR.rtMs, MIN_SCALE.rtMs),
    pitchHz: voiced.length >= 5 ? median(voiced) : null,
    fillerRate: stat(answers.map(fillerRate), PRIOR.fillerRate, MIN_SCALE.fillerRate),
    pauseRatio: stat(answers.map(pauseRatio), PRIOR.pauseRatio, MIN_SCALE.pauseRatio),
    wordsPerSec: stat(answers.map((a) => a.wordsPerSec), PRIOR.wordsPerSec, MIN_SCALE.wordsPerSec),
    // The phone's rolling one-minute blink rate is steadier than a few seconds of counting.
    blink: faces.length >= 20 ? stat([mean(faces.map((s) => s.f.face.blinkPm))], PRIOR.blinkPm, MIN_SCALE.blinkPm) : stat([], PRIOR.blinkPm, MIN_SCALE.blinkPm),
    lip: lips.length >= 5 ? { mean: mean(lips), scale: Math.max(std(lips), MIN_SCALE.lip) } : stat([], PRIOR.lip, MIN_SCALE.lip),
  };
}

const z = (x: number | null, s: Stat) => (x === null ? null : clampZ((x - s.mean) / s.scale));

/** z-scores for one answer, plus the weighted delivery score over the features it has. */
export function scoreAnswer(m: AnswerMetrics, b: Baseline): { z: AnswerZ; delivery: number | null } {
  const hesitationParts = [
    z(fillerRate(m), b.fillerRate),
    z(pauseRatio(m), b.pauseRatio),
    // Slower speech than usual counts towards hesitation.
    m.wordsPerSec === null ? null : -z(m.wordsPerSec, b.wordsPerSec)!,
  ].filter((v): v is number => v !== null);

  const blink = z(m.blinkPm, b.blink);
  const scores: AnswerZ = {
    rt: z(m.rtMs, b.rt),
    pitch: m.pitchShiftSt === null ? null : clampZ(m.pitchShiftSt / MIN_SCALE.pitchSt),
    hesitation: hesitationParts.length > 0 ? clampZ(mean(hesitationParts)) : null,
    // Blinking can rise or drop under pressure, so any change from baseline counts.
    blink: blink === null ? null : Math.abs(blink),
    lip: z(m.lipPress, b.lip),
  };

  let sum = 0;
  let weight = 0;
  for (const key of Object.keys(WEIGHTS) as (keyof AnswerZ)[]) {
    const value = scores[key];
    if (value === null) continue;
    sum += WEIGHTS[key] * value;
    weight += WEIGHTS[key];
  }
  return { z: scores, delivery: weight > 0 ? sum / weight : null };
}

/** Mean delivery score per player over their scored (non-baseline) answers. */
export function meanDelivery(answers: AnswerResult[], playerId: string): number | null {
  const ds = answers.filter((a) => a.playerId === playerId && a.delivery !== null).map((a) => a.delivery!);
  return ds.length > 0 ? mean(ds) : null;
}

/**
 * SPEC fallback verdict: the highest combined score, where combined is delivery plus a content
 * check (did the answers mention anything related to the secret word?).
 */
export function localVerdict(
  round: number,
  word: string,
  imposterId: string,
  players: { id: string; name: string }[],
  answers: AnswerResult[],
  baselines: Map<string, Baseline>,
): Verdict {
  const scored = answers.filter((a) => a.kind !== 'baseline');
  // Content only counts if everyone has transcripts; otherwise it would favour whoever's mic failed.
  const contentFor = (id: string) => {
    const mine = scored.filter((a) => a.playerId === id && a.metrics.transcript.trim());
    if (mine.length === 0) return null;
    const relevant = mine.filter((a) => relatedHits(word, a.metrics.transcript) > 0).length;
    return 1 - relevant / mine.length;
  };
  const content = new Map(players.map((p) => [p.id, contentFor(p.id)]));
  const useContent = [...content.values()].every((c) => c !== null);

  const scores: PlayerScore[] = players.map((p) => {
    const delivery = meanDelivery(scored, p.id);
    const c = useContent ? content.get(p.id)! : null;
    return { playerId: p.id, delivery, content: c, combined: (delivery ?? 0) + (c ?? 0) };
  });
  const top = Math.max(...scores.map((s) => s.combined));
  const leaders = scores.filter((s) => s.combined === top);
  const accused = leaders[Math.floor(Math.random() * leaders.length)]!;

  return {
    round,
    word,
    imposterId,
    accusedId: accused.playerId,
    correct: accused.playerId === imposterId,
    source: 'local',
    scores,
    evidence: evidenceFor(accused, scored.filter((a) => a.playerId === accused.playerId), baselines.get(accused.playerId)),
  };
}

/** Plain-language reasons for the accusation, strongest first. */
function evidenceFor(score: PlayerScore, answers: AnswerResult[], baseline: Baseline | undefined): string[] {
  const lines: { weight: number; text: string }[] = [];
  const avg = (pick: (a: AnswerResult) => number | null) => {
    const xs = answers.map(pick).filter((v): v is number => v !== null);
    return xs.length > 0 ? mean(xs) : null;
  };

  const rt = avg((a) => a.metrics.rtMs);
  const zRt = avg((a) => a.z?.rt ?? null);
  if (rt !== null && baseline && zRt !== null && zRt > 0.5) {
    lines.push({ weight: zRt * WEIGHTS.rt, text: `Took ${((rt - baseline.rt.mean) / 1000).toFixed(1)} s longer than usual to start answering` });
  }
  const shift = avg((a) => a.metrics.pitchShiftSt);
  if (shift !== null && shift > 0.8) {
    lines.push({ weight: (shift / MIN_SCALE.pitchSt) * WEIGHTS.pitch, text: `Voice rose ${shift.toFixed(1)} semitones above their calm pitch` });
  }
  const fillers = answers.reduce((n, a) => n + (a.metrics.fillers ?? 0), 0);
  if (fillers >= 2) lines.push({ weight: fillers * 0.1, text: `Said "um", "uh" or "like" ${fillers} times` });
  const pauses = answers.reduce((n, a) => n + (a.metrics.pauseCount ?? 0), 0);
  if (pauses >= 2) lines.push({ weight: pauses * 0.08, text: `Paused ${pauses} times mid-answer` });
  const zBlink = avg((a) => a.z?.blink ?? null);
  const blink = avg((a) => a.metrics.blinkPm);
  if (zBlink !== null && zBlink > 1 && blink !== null && baseline) {
    lines.push({ weight: zBlink * WEIGHTS.blink, text: `Blink rate went from ${baseline.blink.mean.toFixed(0)} to ${blink.toFixed(0)} per minute` });
  }
  const zLip = avg((a) => a.z?.lip ?? null);
  if (zLip !== null && zLip > 1) lines.push({ weight: zLip * WEIGHTS.lip, text: 'Pressed their lips together more than usual' });
  if (score.content !== null && score.content >= 0.5) {
    lines.push({ weight: score.content, text: 'Answers never mentioned anything specific about the secret' });
  }

  lines.sort((a, b) => b.weight - a.weight);
  const out = lines.slice(0, 3).map((l) => l.text);
  return out.length > 0 ? out : ['Drifted furthest from their calm baseline overall'];
}
