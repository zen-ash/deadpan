// The phone's side of a turn: Scribe while it's this player's turn, the speech-detector reset when
// the answer starts, and the transcript back to the server when it ends.
import type { ClientToServer } from '@deadpan/shared';
import { ScribeSession, type ScribeStatus } from './scribe';
import type { VoiceAnalyser } from './voice';

/** Live subtitles on the big screen don't need every partial. */
const PARTIAL_EVERY_MS = 300;

export interface TurnDeps {
  audioCtx: AudioContext;
  stream: MediaStream;
  send(msg: ClientToServer): void;
  toServer(local: number): number;
  voice(): VoiceAnalyser | null;
  onScribeStatus(status: string): void;
}

export class TurnController {
  private session: ScribeSession | null = null;
  private sessionTurn: string | null = null;
  private answeringTurn: string | null = null;
  private lastPartialAt = 0;

  constructor(private readonly deps: TurnDeps) {}

  /** The server minted a Scribe token for this turn: connect now, stream once the answer starts. */
  onScribe(turnId: string, url: string) {
    this.session?.close();
    this.sessionTurn = turnId;
    this.session = new ScribeSession(url, this.deps.audioCtx, this.deps.stream, this.deps.toServer, {
      onPartial: (text) => {
        if (Date.now() - this.lastPartialAt < PARTIAL_EVERY_MS) return;
        this.lastPartialAt = Date.now();
        this.deps.send({ t: 'transcript', turnId, final: false, text, words: [] });
      },
      onStatus: (status: ScribeStatus, detail?: string) => {
        this.deps.onScribeStatus(detail ? `${status}: ${detail}` : status);
        if (status === 'error') this.deps.send({ t: 'diag', msg: `scribe ${detail ?? 'error'}` });
      },
    });
    if (this.answeringTurn === turnId) this.session.startStreaming();
  }

  onYourTurn(turnId: string) {
    this.answeringTurn = turnId;
    this.deps.voice()?.resetSpeech();
    if (this.sessionTurn === turnId) this.session?.startStreaming();
  }

  async onTurnOver(turnId: string) {
    if (this.answeringTurn === turnId) this.answeringTurn = null;
    if (this.sessionTurn !== turnId || !this.session) return;
    const session = this.session;
    this.session = null;
    this.sessionTurn = null;
    const result = await session.finish();
    this.deps.send({ t: 'transcript', turnId, final: true, text: result.text, words: result.words });
  }

  done(turnId: string) {
    this.deps.send({ t: 'done', turnId });
  }

  dispose() {
    this.session?.close();
    this.session = null;
  }
}
