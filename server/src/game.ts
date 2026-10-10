// The Imposter round, run by the server:
// lobby → baseline → deal → (question → answer) × 2 per player → follow-up → verdict → lobby.
// Every wait has a timeout, so a round always finishes even if the big screen or Scribe goes quiet.
import { randomUUID } from 'node:crypto';
import {
  ANSWER_CAP_MS,
  DEAL_MS,
  MIN_RESPONSE_MS,
  SILENCE_END_MS,
  type AnswerResult,
  type ClientToServer,
  type GameState,
  type Phase,
  type TranscriptWord,
  type TurnInfo,
  type TurnKind,
  type Verdict,
} from '@deadpan/shared';
import type { WebSocket } from 'ws';
import { broadcast, send, sendToHosts, type Player, type Room } from './room';
import { answerMetrics, buildBaseline, localVerdict, meanDelivery, scoreAnswer, type Baseline, type Window } from './scoring';
import { scribeUrl } from './scribe';
import { BASELINE_QUESTIONS, FOLLOWUPS, QUESTIONS, pickWord, shuffled } from './words';

const BASELINE_PER_PLAYER = 1;
const QUESTIONS_PER_PLAYER = 2;
/** If the big screen never reports that a line finished, assume it did after this extra time. */
const TTS_GRACE_MS = 4000;
/** How long to wait for Scribe's final transcript once an answer ends. */
const TRANSCRIPT_GRACE_MS = 1500;
const MAX_WORDS = 400;

interface PlannedTurn {
  kind: TurnKind;
  playerId: string;
  text: string;
  index: number;
  total: number;
}

interface ActiveTurn {
  info: TurnInfo;
  /** A Scribe URL went to the phone, so a final transcript is worth waiting for. */
  scribe: boolean;
  heardSpeech: boolean;
  lastSpeechEnd: number | null;
  answerEnd: number | null;
  words: TranscriptWord[];
  text: string;
  final: boolean;
  scored: boolean;
  timers: Set<NodeJS.Timeout>;
  silenceTimer?: NodeJS.Timeout;
}

export class ImposterGame {
  private phase: Phase = 'lobby';
  private round = 0;
  private roundPlayers: string[] = [];
  private dealEndsAt: number | null = null;
  private word: string | null = null;
  private imposterId: string | null = null;
  private queue: PlannedTurn[] = [];
  private turn: ActiveTurn | null = null;
  private answers: AnswerResult[] = [];
  private readonly baselineWindows = new Map<string, Window[]>();
  private readonly baselines = new Map<string, Baseline>();
  private verdict: Verdict | null = null;
  private phaseTimer: NodeJS.Timeout | undefined;

  constructor(private readonly room: Room) {}

  get state(): GameState {
    return {
      phase: this.phase,
      round: this.round,
      roundPlayers: this.roundPlayers,
      turn: this.turn?.info ?? null,
      dealEndsAt: this.dealEndsAt,
    };
  }

  /** Catches up a host or phone that just connected. */
  syncTo(ws: WebSocket) {
    send(ws, { t: 'state', ...this.state });
    if (this.phase === 'verdict' && this.verdict) send(ws, { t: 'verdict', ...this.verdict });
  }

  /** Starts a round with everyone in the room. Returns an error message if it can't. */
  start(): string | null {
    if (this.phase !== 'lobby' && this.phase !== 'verdict') return 'A round is already running.';
    const players = [...this.room.players.values()];
    if (players.length === 0) return 'Nobody has joined yet.';

    this.reset();
    this.round++;
    this.roundPlayers = players.map((p) => p.id);
    this.phase = 'baseline';
    const softballs = shuffled(BASELINE_QUESTIONS);
    const total = players.length * BASELINE_PER_PLAYER;
    this.queue = players.flatMap((p, i) =>
      Array.from({ length: BASELINE_PER_PLAYER }, (_, k) => ({
        kind: 'baseline' as const,
        playerId: p.id,
        text: softballs[(i * BASELINE_PER_PLAYER + k) % softballs.length]!,
        index: i * BASELINE_PER_PLAYER + k + 1,
        total,
      })),
    );
    this.log(`round ${this.round} started with ${players.map((p) => p.name).join(', ')}`);
    this.nextTurn();
    return null;
  }

  /** Back to the lobby, from the verdict or mid-round. */
  end() {
    this.reset();
    this.phase = 'lobby';
    this.broadcastState();
  }

  dispose() {
    this.reset();
  }

  onTtsEnd(lineId: string, at: number) {
    const turn = this.turn;
    if (!turn || turn.info.id !== lineId || turn.info.stage !== 'asking') return;
    const now = Date.now();
    this.startAnswer(turn, Math.abs(at - now) < 3000 ? at : now);
  }

  onSpeech(player: Player, on: boolean, at: number) {
    const turn = this.turn;
    if (!turn || turn.info.playerId !== player.id || turn.info.stage !== 'answering') return;
    if (on) {
      if (at < turn.info.questionEnd! + MIN_RESPONSE_MS) return;
      turn.heardSpeech = true;
      clearTimeout(turn.silenceTimer);
    } else if (turn.heardSpeech) {
      turn.lastSpeechEnd = at;
      clearTimeout(turn.silenceTimer);
      turn.silenceTimer = setTimeout(() => this.finishAnswer(turn, 'silence'), Math.max(0, at + SILENCE_END_MS - Date.now()));
    }
  }

  onTranscript(player: Player, msg: Extract<ClientToServer, { t: 'transcript' }>) {
    const turn = this.turn;
    if (!turn || turn.info.id !== msg.turnId || turn.info.playerId !== player.id || turn.final) return;
    const text = String(msg.text ?? '').slice(0, 2000);
    turn.text = text;
    if (Array.isArray(msg.words) && msg.words.length > 0) turn.words = sanitizeWords(msg.words);
    sendToHosts(this.room, { t: 'live_transcript', playerId: player.id, turnId: turn.info.id, text, final: Boolean(msg.final) });
    if (msg.final) {
      turn.final = true;
      if (turn.info.stage === 'scoring') this.scoreTurn(turn);
    }
  }

  onDone(player: Player, turnId: string) {
    const turn = this.turn;
    if (turn && turn.info.id === turnId && turn.info.playerId === player.id) this.finishAnswer(turn, 'done');
  }

  onPlayerLeft(playerId: string) {
    if (!this.roundPlayers.includes(playerId)) return;
    this.roundPlayers = this.roundPlayers.filter((id) => id !== playerId);
    if (this.phase === 'lobby' || this.phase === 'verdict') return;
    if (this.roundPlayers.length === 0 || playerId === this.imposterId) {
      this.log(playerId === this.imposterId ? 'the imposter left; round abandoned' : 'everyone left; round abandoned');
      this.end();
      return;
    }
    this.queue = this.queue.filter((t) => t.playerId !== playerId);
    if (this.turn?.info.playerId === playerId) {
      this.clearTurn(this.turn);
      this.nextTurn();
    } else {
      this.broadcastState();
    }
  }

  // Turn flow

  private nextTurn(): void {
    if (this.turn) this.clearTurn(this.turn);
    this.turn = null;
    const planned = this.queue.shift();
    if (planned) return this.beginTurn(planned);
    if (this.phase === 'baseline') return this.deal();
    if (this.phase === 'question') return this.followUp();
    if (this.phase === 'followup') return this.decide();
  }

  private beginTurn(planned: PlannedTurn): void {
    const player = this.room.players.get(planned.playerId);
    if (!player || !this.roundPlayers.includes(planned.playerId)) return this.nextTurn();

    const turn: ActiveTurn = {
      info: { id: randomUUID(), ...planned, stage: 'asking', questionEnd: null, answerDeadline: null },
      scribe: false,
      heardSpeech: false,
      lastSpeechEnd: null,
      answerEnd: null,
      words: [],
      text: '',
      final: false,
      scored: false,
      timers: new Set(),
    };
    this.turn = turn;
    this.broadcastState();

    // The phone opens its Scribe socket while the question plays, so no words are lost.
    void scribeUrl().then((url) => {
      if (!url || this.turn !== turn || turn.info.stage === 'scoring') return;
      turn.scribe = true;
      send(player.ws, { t: 'scribe', turnId: turn.info.id, url });
    });

    // The big screen reports when the line finishes (tts_end). If it never does, carry on.
    const estimate = Math.max(1500, turn.info.text.split(/\s+/).length * 400);
    this.after(turn, estimate + TTS_GRACE_MS, () => this.startAnswer(turn, Date.now()));
  }

  private startAnswer(turn: ActiveTurn, questionEnd: number) {
    if (this.turn !== turn || turn.info.stage !== 'asking') return;
    this.clearTurn(turn);
    turn.info.stage = 'answering';
    turn.info.questionEnd = questionEnd;
    turn.info.answerDeadline = questionEnd + ANSWER_CAP_MS;
    const player = this.room.players.get(turn.info.playerId);
    if (player) send(player.ws, { t: 'your_turn', turnId: turn.info.id, questionEnd });
    this.broadcastState();
    this.after(turn, turn.info.answerDeadline - Date.now(), () => this.finishAnswer(turn, 'cap'));
  }

  private finishAnswer(turn: ActiveTurn, reason: 'done' | 'silence' | 'cap'): void {
    if (this.turn !== turn || turn.info.stage !== 'answering') return;
    this.clearTurn(turn);
    const now = Date.now();
    turn.answerEnd = reason === 'silence' && turn.lastSpeechEnd ? Math.min(now, turn.lastSpeechEnd + 300) : now;
    turn.info.stage = 'scoring';
    const player = this.room.players.get(turn.info.playerId);
    if (player) send(player.ws, { t: 'turn_over', turnId: turn.info.id });
    this.broadcastState();
    this.log(`${player?.name ?? '?'} finished answering (${reason})`);
    if (!turn.scribe || turn.final) return this.scoreTurn(turn);
    this.after(turn, TRANSCRIPT_GRACE_MS, () => this.scoreTurn(turn));
  }

  private scoreTurn(turn: ActiveTurn): void {
    if (this.turn !== turn || turn.info.stage !== 'scoring' || turn.scored) return;
    turn.scored = true;
    this.clearTurn(turn);
    const { id, playerId, kind, text } = turn.info;
    const player = this.room.players.get(playerId);
    if (player) {
      const window: Window = { start: turn.info.questionEnd!, end: turn.answerEnd! };
      const baseline = this.baselines.get(playerId);
      const metrics = answerMetrics(player.samples, player.speech, window, turn.words, turn.text, baseline?.pitchHz ?? null);
      let scored: Pick<AnswerResult, 'z' | 'delivery'> = { z: null, delivery: null };
      if (kind === 'baseline') {
        this.baselineWindows.set(playerId, [...(this.baselineWindows.get(playerId) ?? []), window]);
      } else if (baseline) {
        scored = scoreAnswer(metrics, baseline);
      }
      const result: AnswerResult = { turnId: id, playerId, kind, question: text, metrics, ...scored };
      this.answers.push(result);
      sendToHosts(this.room, { t: 'answer', ...result });
      const rt = metrics.rtMs === null ? 'no speech' : `rt ${(metrics.rtMs / 1000).toFixed(2)} s`;
      const delivery = result.delivery === null ? '' : `, delivery ${result.delivery.toFixed(2)}`;
      this.log(`${player.name} ${kind}: ${rt}, ${metrics.words} words${delivery}`);
    }
    this.nextTurn();
  }

  // Phases

  private deal(): void {
    const now = Date.now();
    this.roundPlayers = this.roundPlayers.filter((id) => this.room.players.has(id));
    if (this.roundPlayers.length === 0) return this.end();
    for (const id of this.roundPlayers) {
      const player = this.room.players.get(id)!;
      const softballs = this.answers.filter((a) => a.playerId === id && a.kind === 'baseline').map((a) => a.metrics);
      this.baselines.set(id, buildBaseline(softballs, player.samples, this.baselineWindows.get(id) ?? [], now));
    }

    this.word = pickWord();
    this.imposterId = this.roundPlayers[Math.floor(Math.random() * this.roundPlayers.length)]!;
    this.phase = 'deal';
    this.dealEndsAt = now + DEAL_MS;
    for (const id of this.roundPlayers) {
      send(this.room.players.get(id)!.ws, { t: 'secret', word: id === this.imposterId ? null : this.word });
    }
    this.broadcastState();
    this.phaseTimer = setTimeout(() => this.askQuestions(), DEAL_MS);
  }

  private askQuestions() {
    this.phase = 'question';
    this.dealEndsAt = null;
    const pool = shuffled(QUESTIONS);
    const total = QUESTIONS_PER_PLAYER * this.roundPlayers.length;
    this.queue = [];
    // Round-robin, so everyone answers once before anyone answers twice.
    for (let r = 0; r < QUESTIONS_PER_PLAYER; r++) {
      for (const playerId of this.roundPlayers) {
        this.queue.push({ kind: 'question', playerId, text: pool[this.queue.length % pool.length]!, index: this.queue.length + 1, total });
      }
    }
    this.nextTurn();
  }

  private followUp(): void {
    this.phase = 'followup';
    // Grill whoever has drifted furthest from their own baseline so far.
    const scored = this.answers.filter((a) => a.kind === 'question');
    const ranked = shuffled(this.roundPlayers).sort((a, b) => (meanDelivery(scored, b) ?? -Infinity) - (meanDelivery(scored, a) ?? -Infinity));
    const target = ranked[0];
    if (!target) return this.end();
    this.queue = [{ kind: 'followup', playerId: target, text: shuffled(FOLLOWUPS)[0]!, index: 1, total: 1 }];
    this.nextTurn();
  }

  private decide() {
    const players = this.roundPlayers.map((id) => ({ id, name: this.room.players.get(id)?.name ?? '?' }));
    this.verdict = localVerdict(this.round, this.word!, this.imposterId!, players, this.answers, this.baselines);
    this.phase = 'verdict';
    this.broadcastState();
    broadcast(this.room, { t: 'verdict', ...this.verdict });
    const name = (id: string) => this.room.players.get(id)?.name ?? '?';
    this.log(
      `verdict: accused ${name(this.verdict.accusedId)}, imposter was ${name(this.verdict.imposterId)}, ` +
        `word "${this.verdict.word}" (${this.verdict.correct ? 'caught' : 'missed'})`,
    );
  }

  // Helpers

  private broadcastState() {
    broadcast(this.room, { t: 'state', ...this.state });
  }

  private after(turn: ActiveTurn, ms: number, fn: () => void) {
    turn.timers.add(setTimeout(fn, Math.max(0, ms)));
  }

  private clearTurn(turn: ActiveTurn) {
    for (const t of turn.timers) clearTimeout(t);
    turn.timers.clear();
    clearTimeout(turn.silenceTimer);
  }

  private reset() {
    if (this.turn) this.clearTurn(this.turn);
    clearTimeout(this.phaseTimer);
    this.turn = null;
    this.queue = [];
    this.answers = [];
    this.baselines.clear();
    this.baselineWindows.clear();
    this.verdict = null;
    this.word = null;
    this.imposterId = null;
    this.dealEndsAt = null;
    this.roundPlayers = [];
  }

  private log(message: string) {
    console.log(`[room ${this.room.code}] ${message}`);
  }
}

function sanitizeWords(words: unknown[]): TranscriptWord[] {
  const out: TranscriptWord[] = [];
  for (const w of words.slice(0, MAX_WORDS)) {
    if (!w || typeof w !== 'object') continue;
    const { w: text, start, end } = w as Record<string, unknown>;
    if (typeof text !== 'string' || typeof start !== 'number' || typeof end !== 'number') continue;
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    out.push({ w: text.slice(0, 40), start, end });
  }
  return out;
}
