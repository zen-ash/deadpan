// The Imposter round, run by the server as one script:
// intro → baseline → deal → (question → answer) × 2 per player → Gemini follow-up →
// drumroll while Gemini decides → spoken verdict → reveal.
// Every wait has a timeout, and ending the round cancels whatever is pending, so a round always
// finishes even if the big screen, Scribe, Gemini or ElevenLabs goes quiet.
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
  type VerdictStage,
} from '@deadpan/shared';
import type { WebSocket } from 'ws';
import { canned, dynamic, sfxMs, type Line } from './audio';
import * as detective from './detective';
import { BASELINE, CASE_CLOSED, DEAL, FOLLOWUP_FALLBACKS, HEARD_ENOUGH, QUESTIONS, VERDICT_FALLBACKS, YOU_GOT_ME, intro, pick } from './lines';
import { broadcast, send, sendToHosts, type Player, type Room } from './room';
import { answerMetrics, buildBaseline, localVerdict, meanDelivery, scoreAnswer, type Baseline, type Window } from './scoring';
import { scribeUrl } from './scribe';
import { pickWord, shuffled } from './words';

const QUESTIONS_PER_PLAYER = 2;
/** Extra time a line may take beyond its expected length before the round moves on anyway. */
const LINE_GRACE_MS = 4000;
/** How long to wait for Scribe's final transcript once an answer ends. */
const TRANSCRIPT_GRACE_MS = 1500;
const MAX_WORDS = 400;

interface Run {
  id: number;
  aborted: boolean;
}

interface PlannedTurn {
  kind: TurnKind;
  playerId: string;
  line: Line;
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
  /** Resolves the turn's promise in the round script. */
  settle: () => void;
}

export class ImposterGame {
  private phase: Phase = 'lobby';
  private round = 0;
  private roundPlayers: string[] = [];
  private dealEndsAt: number | null = null;
  private verdictStage: VerdictStage | null = null;
  private word: string | null = null;
  private imposterId: string | null = null;
  private turn: ActiveTurn | null = null;
  private answers: AnswerResult[] = [];
  private readonly baselineWindows = new Map<string, Window[]>();
  private readonly baselines = new Map<string, Baseline>();
  private verdict: Verdict | null = null;
  private run: Run | null = null;
  /** Everything the round script is waiting on; ending the round resolves them all. */
  private readonly cancels = new Set<() => void>();
  private pendingLine: { id: string; done: (at: number) => void } | null = null;
  private lineSeq = 0;

  constructor(private readonly room: Room) {}

  get state(): GameState {
    return {
      phase: this.phase,
      round: this.round,
      roundPlayers: this.roundPlayers,
      turn: this.turn?.info ?? null,
      dealEndsAt: this.dealEndsAt,
      verdictStage: this.verdictStage,
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

    this.cancelRun();
    this.reset();
    this.round++;
    this.roundPlayers = players.map((p) => p.id);
    const run: Run = { id: this.round, aborted: false };
    this.run = run;
    this.log(`round ${this.round} started with ${players.map((p) => p.name).join(', ')}`);
    void this.play(run).catch((err: unknown) => {
      console.error(`[room ${this.room.code}] round crashed:`, err);
      if (this.run === run) this.end();
    });
    return null;
  }

  /** Back to the lobby, from the verdict or mid-round. */
  end() {
    this.cancelRun();
    this.reset();
    this.phase = 'lobby';
    this.broadcastState();
  }

  dispose() {
    this.cancelRun();
    this.reset();
  }

  // The round script

  private async play(run: Run) {
    const live = () => this.run === run && !run.aborted;

    this.setPhase('baseline');
    await this.say(run, canned(intro(this.roundPlayers.length)));
    const softballs = shuffled(BASELINE);
    const calibrating = [...this.roundPlayers];
    for (const [i, playerId] of calibrating.entries()) {
      if (!live()) return;
      await this.playTurn(run, { kind: 'baseline', playerId, line: canned(softballs[i % softballs.length]!), index: i + 1, total: calibrating.length });
    }

    if (!live()) return;
    if (!this.deal()) return this.end();
    await Promise.all([this.say(run, canned(DEAL)), this.sleep(run, DEAL_MS)]);

    if (!live()) return;
    this.dealEndsAt = null;
    this.setPhase('question');
    const pool = shuffled(QUESTIONS);
    const total = QUESTIONS_PER_PLAYER * this.roundPlayers.length;
    let asked = 0;
    // Round-robin, so everyone answers once before anyone answers twice.
    for (let r = 0; r < QUESTIONS_PER_PLAYER; r++) {
      for (const playerId of [...this.roundPlayers]) {
        if (!live()) return;
        if (!this.roundPlayers.includes(playerId)) continue;
        await this.playTurn(run, { kind: 'question', playerId, line: canned(pool[asked % pool.length]!), index: ++asked, total });
      }
    }

    if (!live()) return;
    this.setPhase('followup');
    const followUp = await this.prepareFollowUp();
    if (!live()) return;
    if (followUp) await this.playTurn(run, { kind: 'followup', ...followUp, index: 1, total: 1 });

    if (!live()) return;
    await this.decide(run);
  }

  /** Gemini picks who to grill and writes the line; the fallback grills whoever drifted most. */
  private async prepareFollowUp(): Promise<{ playerId: string; line: Line } | null> {
    const fromGemini = await detective.followUp(this.context());
    if (fromGemini && this.roundPlayers.includes(fromGemini.targetId)) {
      const line = await dynamic(fromGemini.spoken);
      return { playerId: fromGemini.targetId, line: line ?? canned(pick(FOLLOWUP_FALLBACKS)) };
    }
    const scored = this.answers.filter((a) => a.kind === 'question');
    const ranked = shuffled(this.roundPlayers).sort((a, b) => (meanDelivery(scored, b) ?? -Infinity) - (meanDelivery(scored, a) ?? -Infinity));
    return ranked[0] ? { playerId: ranked[0], line: canned(pick(FOLLOWUP_FALLBACKS)) } : null;
  }

  /** Drumroll while Gemini decides (SPEC: the verdict call starts at the drumroll), then the reveal. */
  private async decide(run: Run) {
    const live = () => this.run === run && !run.aborted;
    this.verdictStage = 'deliberating';
    this.setPhase('verdict');
    await this.say(run, canned(HEARD_ENOUGH));
    if (!live()) return;

    sendToHosts(this.room, { t: 'sfx', name: 'drumroll' });
    const players = this.roundPlayers.map((id) => ({ id, name: this.name(id) }));
    const local = localVerdict(this.round, this.word!, this.imposterId!, players, this.answers, this.baselines);
    const [fromGemini] = await Promise.all([detective.verdict(this.context(), local.scores), this.sleep(run, sfxMs('drumroll'))]);
    if (!live()) return;

    let verdict: Verdict;
    let spoken: string;
    if (fromGemini) {
      spoken = fromGemini.spoken;
      verdict = {
        ...local,
        accusedId: fromGemini.accusedId,
        correct: fromGemini.accusedId === this.imposterId,
        source: 'gemini',
        confidence: fromGemini.confidence,
        evidence: fromGemini.evidence.length > 0 ? fromGemini.evidence : local.evidence,
        spoken: '',
      };
    } else {
      spoken = `[low, gravelly] I've watched every one of you. [pause] The imposter... is ${this.name(local.accusedId)}.`;
      verdict = local;
    }
    const line = (await dynamic(spoken)) ?? canned(pick(VERDICT_FALLBACKS));
    if (!live()) return;
    verdict.spoken = line.text;
    this.verdict = verdict;
    this.verdictStage = 'accusing';
    this.broadcastState();
    broadcast(this.room, { t: 'verdict', ...verdict });
    await this.say(run, line);

    if (!live()) return;
    this.verdictStage = 'revealed';
    this.broadcastState();
    sendToHosts(this.room, { t: 'sfx', name: 'stinger' });
    await this.say(run, canned(pick(verdict.correct ? CASE_CLOSED : YOU_GOT_ME)));
    if (verdict.correct && live()) sendToHosts(this.room, { t: 'sfx', name: 'caseclosed' });
    this.log(
      `verdict (${verdict.source}): accused ${this.name(verdict.accusedId)}, imposter was ${this.name(verdict.imposterId)}, ` +
        `word "${verdict.word}" (${verdict.correct ? 'caught' : 'missed'})`,
    );
  }

  private deal(): boolean {
    const now = Date.now();
    this.roundPlayers = this.roundPlayers.filter((id) => this.room.players.has(id));
    if (this.roundPlayers.length === 0) return false;
    for (const id of this.roundPlayers) {
      const player = this.room.players.get(id)!;
      const softballs = this.answers.filter((a) => a.playerId === id && a.kind === 'baseline').map((a) => a.metrics);
      this.baselines.set(id, buildBaseline(softballs, player.samples, this.baselineWindows.get(id) ?? [], now));
    }
    this.word = pickWord();
    this.imposterId = this.roundPlayers[Math.floor(Math.random() * this.roundPlayers.length)]!;
    this.dealEndsAt = now + DEAL_MS;
    for (const id of this.roundPlayers) {
      send(this.room.players.get(id)!.ws, { t: 'secret', word: id === this.imposterId ? null : this.word });
    }
    this.setPhase('deal');
    return true;
  }

  // One turn: the question plays, the answer is timed, then scored.

  private async playTurn(run: Run, planned: PlannedTurn): Promise<void> {
    const player = this.room.players.get(planned.playerId);
    if (!player || !this.roundPlayers.includes(planned.playerId)) return;

    let settle!: () => void;
    const settled = new Promise<void>((resolve) => (settle = resolve));
    const turn: ActiveTurn = {
      info: {
        id: randomUUID(),
        kind: planned.kind,
        playerId: planned.playerId,
        text: planned.line.text,
        stage: 'asking',
        index: planned.index,
        total: planned.total,
        questionEnd: null,
        answerDeadline: null,
      },
      scribe: false,
      heardSpeech: false,
      lastSpeechEnd: null,
      answerEnd: null,
      words: [],
      text: '',
      final: false,
      scored: false,
      timers: new Set(),
      settle: () => {
        this.cancels.delete(turn.settle);
        settle();
      },
    };
    this.cancels.add(turn.settle);
    this.turn = turn;
    this.broadcastState();

    // The phone opens its Scribe socket while the question plays, so no words are lost.
    void scribeUrl().then((url) => {
      if (!url || this.turn !== turn || turn.info.stage === 'scoring') return;
      turn.scribe = true;
      send(player.ws, { t: 'scribe', turnId: turn.info.id, url });
    });

    const questionEnd = await this.say(run, planned.line);
    if (this.turn === turn && turn.info.stage === 'asking') this.startAnswer(turn, questionEnd);
    else turn.settle();
    await settled;
    if (this.turn === turn) this.turn = null;
  }

  private startAnswer(turn: ActiveTurn, questionEnd: number) {
    turn.info.stage = 'answering';
    turn.info.questionEnd = questionEnd;
    turn.info.answerDeadline = questionEnd + ANSWER_CAP_MS;
    const player = this.room.players.get(turn.info.playerId);
    if (player) send(player.ws, { t: 'your_turn', turnId: turn.info.id, questionEnd });
    this.broadcastState();
    this.after(turn, turn.info.answerDeadline - Date.now(), () => this.finishAnswer(turn, 'cap'));
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

  onTtsEnd(lineId: string, at: number) {
    if (this.pendingLine?.id !== lineId) return;
    const now = Date.now();
    this.pendingLine.done(Math.abs(at - now) < 5000 ? at : now);
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
    const turn = this.turn;
    if (turn?.info.playerId === playerId) {
      this.clearTimers(turn);
      this.turn = null;
      turn.settle();
    }
    this.broadcastState();
  }

  private finishAnswer(turn: ActiveTurn, reason: 'done' | 'silence' | 'cap') {
    if (this.turn !== turn || turn.info.stage !== 'answering') return;
    this.clearTimers(turn);
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

  private scoreTurn(turn: ActiveTurn) {
    if (this.turn !== turn || turn.info.stage !== 'scoring' || turn.scored) return;
    turn.scored = true;
    this.clearTimers(turn);
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
      const drift = result.delivery === null ? '' : `, drift ${result.delivery.toFixed(2)}`;
      this.log(`${player.name} ${kind}: ${rt}, ${metrics.words} words${drift}`);
    }
    turn.settle();
  }

  // Waiting

  /**
   * Has the big screen play a line, and resolves with the server time it finished. Falls back to
   * the line's expected length if no big screen reports back.
   */
  private say(run: Run, line: Line): Promise<number> {
    if (this.run !== run || run.aborted) return Promise.resolve(Date.now());
    const id = `${line.id}~${++this.lineSeq}`;
    return new Promise((resolve) => {
      const done = (at: number) => {
        clearTimeout(timer);
        this.cancels.delete(cancel);
        if (this.pendingLine?.id === id) this.pendingLine = null;
        resolve(at);
      };
      const cancel = () => done(Date.now());
      const timer = setTimeout(cancel, line.expectedMs + (this.room.hosts.size > 0 ? LINE_GRACE_MS : 0));
      this.cancels.add(cancel);
      this.pendingLine = { id, done };
      sendToHosts(this.room, { t: 'say', line: { id, url: line.url, text: line.text } });
    });
  }

  private sleep(run: Run, ms: number): Promise<void> {
    if (this.run !== run || run.aborted) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.cancels.delete(done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      this.cancels.add(done);
    });
  }

  // Helpers

  private context(): detective.DetectiveContext {
    return {
      word: this.word ?? '',
      players: this.roundPlayers.map((id) => ({ id, name: this.name(id) })),
      answers: this.answers,
      baselines: this.baselines,
    };
  }

  private name(id: string): string {
    return this.room.players.get(id)?.name ?? 'someone';
  }

  private setPhase(phase: Phase) {
    this.phase = phase;
    this.broadcastState();
  }

  private broadcastState() {
    broadcast(this.room, { t: 'state', ...this.state });
  }

  private after(turn: ActiveTurn, ms: number, fn: () => void) {
    turn.timers.add(setTimeout(fn, Math.max(0, ms)));
  }

  private clearTimers(turn: ActiveTurn) {
    for (const t of turn.timers) clearTimeout(t);
    turn.timers.clear();
    clearTimeout(turn.silenceTimer);
  }

  private cancelRun() {
    if (this.run) this.run.aborted = true;
    this.run = null;
    for (const cancel of [...this.cancels]) cancel();
    this.cancels.clear();
  }

  private reset() {
    if (this.turn) this.clearTimers(this.turn);
    this.turn = null;
    this.pendingLine = null;
    this.answers = [];
    this.baselines.clear();
    this.baselineWindows.clear();
    this.verdict = null;
    this.verdictStage = null;
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

