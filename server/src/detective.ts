// The detective's brain: Gemini picks who to grill next and names the imposter, returning typed
// JSON (SPEC schemas). Every call has a timeout; on any failure the caller uses the local logic.
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import type { AnswerResult, PlayerScore } from '@deadpan/shared';
import { displayText } from './audio';
import { meanDelivery, type Baseline } from './scoring';
import { tokens } from './words';

// Both calls use 3.8 Flash at low thinking ("minimal" errors on this model).
const FOLLOWUP_MODEL = 'gemini-3.8-flash';
const VERDICT_MODEL = 'gemini-3.8-flash';
const FOLLOWUP_TIMEOUT_MS = 5000;
const VERDICT_TIMEOUT_MS = 6000;
/** A follow-up longer than this is rambling; use a canned line instead. */
const MAX_FOLLOWUP_WORDS = 60;

export interface DetectiveContext {
  word: string;
  players: { id: string; name: string }[];
  answers: AnswerResult[];
  baselines: Map<string, Baseline>;
}

export interface FollowUp {
  targetId: string;
  /** Spoken text, with audio tags. */
  spoken: string;
}

export interface GeminiVerdict {
  accusedId: string;
  confidence: number;
  evidence: string[];
  /** Spoken text, with audio tags. */
  spoken: string;
}

let client: GoogleGenAI | null | undefined;
function gemini(): GoogleGenAI | null {
  if (client === undefined) {
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    client = apiKey ? new GoogleGenAI({ apiKey }) : null;
    if (!client) console.warn('[gemini] GEMINI_API_KEY is not set; the detective uses the local fallback');
  }
  return client;
}

const round2 = (v: number | null) => (v === null ? null : Math.round(v * 100) / 100);

/**
 * Each signal of one answer: the raw value, and its z-score against the player's own calm
 * baseline (0 is their normal; positive is further from calm). Baseline answers have no z-scores.
 */
function signals(a: AnswerResult) {
  const m = a.metrics;
  const z = a.z;
  return {
    response_time: { seconds: m.rtMs === null ? null : round2(m.rtMs / 1000), z: round2(z?.rt ?? null) },
    pauses: { count: m.pauseCount, total_seconds: m.pauseMs === null ? null : round2(m.pauseMs / 1000), z: round2(z?.pauses ?? null) },
    fillers: { count: m.fillers, z: round2(z?.fillers ?? null) },
    pitch_shift: { semitones: round2(m.pitchShiftSt), z: round2(z?.pitch ?? null) },
    blinks: { per_minute: m.blinkPm === null ? null : Math.round(m.blinkPm), z: round2(z?.blink ?? null) },
    lip_press: { level: round2(m.lipPress), z: round2(z?.lip ?? null) },
  };
}

/** What Gemini sees: the word, and every answer with its question, transcript and signals. */
function summary(ctx: DetectiveContext, scores?: PlayerScore[]) {
  const scored = ctx.answers.filter((a) => a.kind !== 'baseline');
  return {
    secret_word: ctx.word,
    players: ctx.players.map((p) => {
      const baseline = ctx.baselines.get(p.id);
      const score = scores?.find((s) => s.playerId === p.id);
      return {
        id: p.id,
        name: p.name,
        overall_drift: round2(meanDelivery(scored, p.id)),
        calm_baseline: baseline
          ? { response_time_seconds: round2(baseline.rt.mean / 1000), pitch_hz: baseline.pitchHz && Math.round(baseline.pitchHz) }
          : null,
        ...(score ? { local_scores: { delivery: round2(score.delivery), content_vagueness: round2(score.content), total: round2(score.combined) } } : {}),
        answers: ctx.answers
          .filter((a) => a.playerId === p.id)
          .map((a) => ({
            kind: a.kind,
            question: displayText(a.question),
            transcript: a.metrics.transcript || '(nothing heard)',
            signals: signals(a),
          })),
      };
    }),
  };
}

const STYLE =
  'Use ElevenLabs v4 audio tags in square brackets for delivery, such as [pause], [whispers], [low, gravelly], ' +
  '[skeptical]. No other markup, no stage directions outside brackets.';

const FOLLOWUP_INSTRUCTIONS = `You are the Detective in Deadpan: a sharp, unhurried film-noir interrogator in a party bluff game.
Everyone except one player, the imposter, was shown the secret word. Players describe it without saying it.

You get the secret word and every answer so far: the question, the transcript, and each signal of the answer
(response time, pauses, fillers, pitch shift, blinks, lip press) as a raw value plus a z-score against that
player's own calm baseline. A z-score of 0 is their normal, around 1 is notable, 2 or more is far off; positive
means slower, more pauses, more fillers, higher pitch, a changed blink rate or more lip pressing. Gaze is not
given because looking away is a myth; never mention eyes or eye contact.

Pick the single most suspicious player. Weigh content first: answers that are vague, generic, contradictory,
or that don't fit the secret word. Then weigh delivery: the signals that drifted furthest from their baseline.

Write one follow-up to that player, 2 or 3 sentences, about 25 to 45 words:
1. Address them by name, then point at one specific thing they said or did, quoting or closely paraphrasing
   their transcript, or citing a signal in plain words ("You took three seconds to answer that",
   "Your voice climbed the whole way through"). Use only facts in the input; never invent any.
2. Then ask one question that anyone who knows the secret word answers instantly, but a bluffer would have to guess.
Never say the secret word, its plural, a synonym, or a detail that gives it away, in any field.
Use two or three ElevenLabs v4 audio tags in square brackets, such as [pause], [whispers] and [low, gravelly].
No other markup and no stage directions outside the brackets.

Examples of the style (they are about other words and other players):
- "[low, gravelly] Riya. You called it tall, [pause] then said you keep one in your kitchen. Which is it? [whispers] Tell me where you'd really find one."
- "Sam. You took three seconds to answer that, and your voice climbed the whole way through. [pause] [low, gravelly] Easy one, then. What colour is it, usually?"
- "[whispers] Marco. You said 'um' four times describing something you claim to know. [pause] So tell me plainly: who uses one every single day?"
- "Priya, you said it reminds you of summer, but you never said where you'd find one. [pause] [low, gravelly] Could you hold one in your hand, or not?"

Return target_player_id, question (the question alone, in plain words) and spoken_line (the full follow-up, with tags).`;

const VERDICT_INSTRUCTIONS = `You are the Detective in Deadpan, a party bluff game with a film-noir voice.
Name the imposter: the one player who was not shown the secret word.
Weigh content first (did their answers show they knew the word? vague, generic or wrong answers are suspicious),
then delivery (drift from their own baseline: slower responses, higher pitch, more fillers and pauses).
local_scores are a simple automatic estimate; you may disagree with them.
content_evidence: one or two short lines (14 words at most) about what the accused said.
delivery_evidence: one or two short lines with concrete numbers from the data, such as "Took 1.9 s longer than usual to answer".
Never cite gaze or eye contact: that cue is a myth.
spoken_verdict is what you say aloud: 30 words at most, building suspense, naming the accused and citing one or two
pieces of evidence, ending on the accusation. You may say the secret word now. confidence is 0 to 1.
${STYLE}`;

/** Fixes common slips: <whispers> or SSML breaks instead of [whispers], stray markdown. */
export function cleanTags(text: string): string {
  return text
    .replace(/<break[^>]*>/gi, ' [pause] ')
    .replace(/<(\/?)([a-z][a-z ,'-]{1,30})>/gi, (_, closing: string, tag: string) => (closing ? '' : `[${tag.trim()}]`))
    .replace(/[*_#`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function mentionsWord(text: string, word: string): boolean {
  const target = tokens(word)[0];
  return !!target && tokens(text).includes(target);
}

async function ask(
  model: string,
  instructions: string,
  input: unknown,
  schema: object,
  level: ThinkingLevel,
  timeoutMs: number,
  log?: string,
) {
  const ai = gemini();
  if (!ai) return null;
  if (log) console.log(`[gemini] ${log} input:\n${JSON.stringify(input, null, 2)}`);
  const started = Date.now();
  try {
    const res = await ai.models.generateContent({
      model,
      contents: JSON.stringify(input),
      config: {
        systemInstruction: instructions,
        responseMimeType: 'application/json',
        responseJsonSchema: schema,
        thinkingConfig: { thinkingLevel: level },
        temperature: 0.9,
        abortSignal: AbortSignal.timeout(timeoutMs),
      },
    });
    console.log(`[gemini] ${model} answered in ${Date.now() - started} ms`);
    if (log) console.log(`[gemini] ${log} output:\n${res.text}`);
    return JSON.parse(res.text ?? 'null') as Record<string, unknown> | null;
  } catch (err) {
    console.warn(`[gemini] ${model} failed after ${Date.now() - started} ms:`, err instanceof Error ? err.message.slice(0, 200) : err);
    return null;
  }
}

/** Follow-up call: 3.8 Flash at low thinking, 5 s. Null means use the canned fallback. */
export async function followUp(ctx: DetectiveContext): Promise<FollowUp | null> {
  const ids = ctx.players.map((p) => p.id);
  if (ids.length === 0) return null;
  const out = await ask(
    FOLLOWUP_MODEL,
    FOLLOWUP_INSTRUCTIONS,
    summary(ctx),
    {
      type: 'object',
      properties: {
        target_player_id: { type: 'string', enum: ids },
        question: { type: 'string' },
        spoken_line: { type: 'string' },
      },
      required: ['target_player_id', 'question', 'spoken_line'],
    },
    ThinkingLevel.LOW,
    FOLLOWUP_TIMEOUT_MS,
    'follow-up',
  );
  if (!out) return null;
  const targetId = String(out.target_player_id ?? '');
  const spoken = cleanTags(String(out.spoken_line ?? '')).slice(0, 500);
  const question = String(out.question ?? '');
  if (!ids.includes(targetId) || !displayText(spoken)) return null;
  if (displayText(spoken).split(/\s+/).length > MAX_FOLLOWUP_WORDS) {
    console.warn('[gemini] follow-up was too long; using a canned line');
    return null;
  }
  if (mentionsWord(spoken, ctx.word) || mentionsWord(question, ctx.word)) {
    console.warn('[gemini] follow-up gave the word away; using a canned line');
    return null;
  }
  return { targetId, spoken };
}

/** SPEC verdict call: 3.8 Flash at low thinking, 6 s. Null means use the local verdict. */
export async function verdict(ctx: DetectiveContext, scores: PlayerScore[]): Promise<GeminiVerdict | null> {
  const ids = ctx.players.map((p) => p.id);
  if (ids.length === 0) return null;
  const lines = { type: 'array', items: { type: 'string' } };
  const out = await ask(
    VERDICT_MODEL,
    VERDICT_INSTRUCTIONS,
    summary(ctx, scores),
    {
      type: 'object',
      properties: {
        accused_player_id: { type: 'string', enum: ids },
        confidence: { type: 'number' },
        content_evidence: lines,
        delivery_evidence: lines,
        spoken_verdict: { type: 'string' },
      },
      required: ['accused_player_id', 'confidence', 'content_evidence', 'delivery_evidence', 'spoken_verdict'],
    },
    ThinkingLevel.LOW,
    VERDICT_TIMEOUT_MS,
  );
  if (!out) return null;
  const accusedId = String(out.accused_player_id ?? '');
  const spoken = cleanTags(String(out.spoken_verdict ?? '')).slice(0, 500);
  if (!ids.includes(accusedId) || !displayText(spoken)) return null;
  const strings = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).slice(0, 2) : []);
  const confidence = Number(out.confidence);
  return {
    accusedId,
    confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0.5,
    evidence: [...strings(out.content_evidence), ...strings(out.delivery_evidence)].map((e) => e.slice(0, 160)),
    spoken,
  };
}
