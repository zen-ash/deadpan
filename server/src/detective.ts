// The detective's brain: Gemini picks who to grill next and names the imposter, returning typed
// JSON (SPEC schemas). Every call has a timeout; on any failure the caller uses the local logic.
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import type { AnswerResult, PlayerScore } from '@deadpan/shared';
import { displayText } from './audio';
import { meanDelivery, type Baseline } from './scoring';
import { tokens } from './words';

const FOLLOWUP_MODEL = 'gemini-3.5-flash-lite';
const VERDICT_MODEL = 'gemini-3.8-flash';
const FOLLOWUP_TIMEOUT_MS = 2500;
const VERDICT_TIMEOUT_MS = 6000;

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

/** What Gemini sees: every answer, with its transcript and how far it drifted from baseline. */
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
        mean_drift: round2(meanDelivery(scored, p.id)),
        baseline: baseline ? { response_time_s: round2(baseline.rt.mean / 1000), pitch_hz: baseline.pitchHz && Math.round(baseline.pitchHz) } : null,
        ...(score ? { local_scores: { delivery: round2(score.delivery), content_vagueness: round2(score.content), total: round2(score.combined) } } : {}),
        answers: ctx.answers
          .filter((a) => a.playerId === p.id)
          .map((a) => ({
            kind: a.kind,
            question: displayText(a.question),
            transcript: a.metrics.transcript || '(no transcript)',
            response_time_s: a.metrics.rtMs === null ? null : round2(a.metrics.rtMs / 1000),
            pitch_shift_semitones: round2(a.metrics.pitchShiftSt),
            fillers: a.metrics.fillers,
            pauses: a.metrics.pauseCount,
            drift: round2(a.delivery),
          })),
      };
    }),
  };
}

const STYLE =
  'Use ElevenLabs v4 audio tags in square brackets for delivery, such as [pause], [whispers], [low, gravelly], ' +
  '[skeptical]. No other markup, no stage directions outside brackets.';

const FOLLOWUP_INSTRUCTIONS = `You are the Detective in Deadpan, a party bluff game with a film-noir voice.
Everyone except one player, the imposter, was shown a secret word. Players describe it without saying it.
You get every answer so far: the transcript, and how far each answer drifted from that player's own calm baseline
(response time, pitch shift in semitones, filler words, pauses). Drift above 0.5 is notable.
Pick the single most suspicious player, weighing vague or off-target answers and drift, and ask them one short
follow-up question (12 words at most) that anyone who knows the word answers instantly but an imposter must guess.
Never say the secret word, its plural, or an obvious synonym, in any field.
spoken_line is exactly what you say aloud: the player's name, then the question, 22 words at most, terse noir style.
${STYLE}`;

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

async function ask(model: string, instructions: string, input: unknown, schema: object, level: ThinkingLevel, timeoutMs: number) {
  const ai = gemini();
  if (!ai) return null;
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
    return JSON.parse(res.text ?? 'null') as Record<string, unknown> | null;
  } catch (err) {
    console.warn(`[gemini] ${model} failed after ${Date.now() - started} ms:`, err instanceof Error ? err.message.slice(0, 200) : err);
    return null;
  }
}

/** SPEC follow-up call: Flash-Lite, 2.5 s. Null means use the local fallback. */
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
    ThinkingLevel.MINIMAL,
    FOLLOWUP_TIMEOUT_MS,
  );
  if (!out) return null;
  const targetId = String(out.target_player_id ?? '');
  const spoken = cleanTags(String(out.spoken_line ?? '')).slice(0, 300);
  const question = String(out.question ?? '');
  if (!ids.includes(targetId) || !displayText(spoken)) return null;
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
