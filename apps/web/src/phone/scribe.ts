// ElevenLabs Scribe v2 Realtime from the phone, during this player's turn only.
// The socket opens (with the server's single-use token) while the question plays; audio streams
// from the existing mic stream once the answer starts; one commit at the end returns the final
// transcript with word timestamps. https://elevenlabs.io/docs/api-reference/speech-to-text/v-1-speech-to-text-realtime
import type { TranscriptWord } from '@deadpan/shared';

const SAMPLE_RATE = 16_000;
const CHUNK_MS = 100;
/** ElevenLabs closes a socket after 15 s without audio, so idle sockets get a little silence. */
const KEEPALIVE_MS = 8000;
const ERROR_TYPES = new Set([
  'auth_error',
  'unaccepted_terms',
  'quota_exceeded',
  'rate_limited',
  'queue_overflow',
  'resource_exhausted',
  'session_time_limit_exceeded',
  'input_error',
  'invalid_request',
  'chunk_size_exceeded',
  'insufficient_audio_activity',
  'commit_throttled',
  'transcriber_error',
  'error',
]);

export type ScribeStatus = 'connecting' | 'ready' | 'streaming' | 'finishing' | 'closed' | 'error';

export interface ScribeCallbacks {
  onPartial(text: string): void;
  onStatus(status: ScribeStatus, detail?: string): void;
}

export interface ScribeResult {
  text: string;
  /** Word timings converted to server time. */
  words: TranscriptWord[];
}

interface ScribeWord {
  text: string;
  start: number;
  end: number;
  type?: string;
}

const loadedWorklets = new WeakSet<AudioContext>();

export class ScribeSession {
  status: ScribeStatus = 'connecting';
  private readonly ws: WebSocket;
  private node: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private readonly downsampler: Downsampler;
  private streaming = false;
  private samplesSent = 0;
  /** Where each sent chunk starts in Scribe's audio, and when its first sample was captured. */
  private readonly chunks: { sample: number; capturedAt: number }[] = [];
  private lastSendAt = 0;
  private keepalive: number | undefined;
  private committed: string[] = [];
  /** ElevenLabs sends the timestamped commit before the plain one, so take the text from it. */
  private timestampedCommits = 0;
  private plainCommits = 0;
  private partial = '';
  private words: TranscriptWord[] = [];
  private awaitingFinal: (() => void) | null = null;

  constructor(
    url: string,
    private readonly audioCtx: AudioContext,
    private readonly stream: MediaStream,
    private readonly toServer: (local: number) => number,
    private readonly callbacks: ScribeCallbacks,
  ) {
    this.downsampler = new Downsampler(audioCtx.sampleRate / SAMPLE_RATE);
    this.ws = new WebSocket(url);
    this.ws.onopen = () => this.setStatus(this.streaming ? 'streaming' : 'ready');
    this.ws.onmessage = (event) => this.onMessage(event);
    this.ws.onclose = () => {
      clearInterval(this.keepalive);
      this.awaitingFinal?.();
      if (this.status !== 'error') this.setStatus('closed');
    };
    this.keepalive = window.setInterval(() => {
      if (!this.streaming && this.ws.readyState === WebSocket.OPEN && Date.now() - this.lastSendAt > KEEPALIVE_MS) {
        this.sendPcm(new Int16Array((SAMPLE_RATE * CHUNK_MS) / 1000), Date.now());
      }
    }, 1000);
    void this.attachAudio();
  }

  /** The answer has started: from now on the mic streams to Scribe. */
  startStreaming() {
    this.streaming = true;
    if (this.ws.readyState === WebSocket.OPEN) this.setStatus('streaming');
  }

  /** Stops streaming, commits, and waits up to `timeoutMs` for the final transcript. */
  async finish(timeoutMs = 1200): Promise<ScribeResult> {
    this.streaming = false;
    this.detachAudio();
    if (this.ws.readyState === WebSocket.OPEN && this.samplesSent > 0) {
      this.setStatus('finishing');
      const done = new Promise<void>((resolve) => {
        this.awaitingFinal = resolve;
        setTimeout(resolve, timeoutMs);
      });
      this.ws.send(JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: '', commit: true, sample_rate: SAMPLE_RATE }));
      await done;
    }
    this.close();
    const text = [...this.committed, this.committed.length === 0 ? this.partial : ''].join(' ').replace(/\s+/g, ' ').trim();
    return { text, words: this.words };
  }

  close() {
    this.streaming = false;
    clearInterval(this.keepalive);
    this.detachAudio();
    if (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN) this.ws.close();
  }

  private async attachAudio() {
    try {
      if (!loadedWorklets.has(this.audioCtx)) {
        await this.audioCtx.audioWorklet.addModule('/worklets/pcm-capture.js');
        loadedWorklets.add(this.audioCtx);
      }
      if (this.status === 'closed' || this.status === 'error') return;
      const chunkSize = Math.round((this.audioCtx.sampleRate * CHUNK_MS) / 1000);
      this.node = new AudioWorkletNode(this.audioCtx, 'pcm-capture', { processorOptions: { chunkSize } });
      this.node.port.onmessage = (event: MessageEvent<Float32Array>) => this.onAudio(event.data);
      this.source = this.audioCtx.createMediaStreamSource(this.stream);
      this.source.connect(this.node);
      this.node.connect(this.audioCtx.destination);
    } catch (err) {
      this.fail(`audio capture failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private detachAudio() {
    this.source?.disconnect();
    this.node?.disconnect();
    if (this.node) this.node.port.onmessage = null;
    this.source = null;
    this.node = null;
  }

  private onAudio(frame: Float32Array) {
    if (!this.streaming || this.ws.readyState !== WebSocket.OPEN) return;
    // The worklet posts a chunk once it fills, so its first sample was captured one chunk ago.
    const capturedAt = Date.now() - (frame.length / this.audioCtx.sampleRate) * 1000;
    this.sendPcm(this.downsampler.process(frame), capturedAt);
  }

  private sendPcm(pcm: Int16Array, capturedAt: number) {
    if (pcm.length === 0) return;
    this.chunks.push({ sample: this.samplesSent, capturedAt });
    this.samplesSent += pcm.length;
    this.lastSendAt = Date.now();
    this.ws.send(
      JSON.stringify({
        message_type: 'input_audio_chunk',
        audio_base_64: toBase64(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength)),
        commit: false,
        sample_rate: SAMPLE_RATE,
      }),
    );
  }

  private onMessage(event: MessageEvent) {
    let msg: { message_type?: string; text?: string; words?: ScribeWord[]; error?: string };
    try {
      msg = JSON.parse(String(event.data));
    } catch {
      return;
    }
    switch (msg.message_type) {
      case 'partial_transcript':
        this.partial = msg.text ?? '';
        this.callbacks.onPartial([...this.committed, this.partial].join(' ').trim());
        break;
      case 'committed_transcript':
        if (++this.plainCommits > this.timestampedCommits && msg.text?.trim()) this.committed.push(msg.text.trim());
        this.partial = '';
        this.callbacks.onPartial(this.committed.join(' '));
        break;
      case 'committed_transcript_with_timestamps':
        // Whichever version of a commit arrives first contributes its text.
        if (++this.timestampedCommits > this.plainCommits && msg.text?.trim()) this.committed.push(msg.text.trim());
        this.partial = '';
        for (const w of msg.words ?? []) {
          if (w.type && w.type !== 'word') continue;
          this.words.push({ w: w.text.trim(), start: this.toServerMs(w.start), end: this.toServerMs(w.end) });
        }
        this.awaitingFinal?.();
        break;
      default:
        if (msg.message_type && ERROR_TYPES.has(msg.message_type)) this.fail(`${msg.message_type}: ${msg.error ?? ''}`);
    }
  }

  /** Seconds into Scribe's audio → the server time that audio was captured. */
  private toServerMs(seconds: number): number {
    const sample = seconds * SAMPLE_RATE;
    let chunk = this.chunks[0];
    for (const c of this.chunks) {
      if (c.sample > sample) break;
      chunk = c;
    }
    const local = chunk ? chunk.capturedAt + ((sample - chunk.sample) / SAMPLE_RATE) * 1000 : Date.now();
    return Math.round(this.toServer(local));
  }

  private fail(detail: string) {
    this.setStatus('error', detail);
    this.awaitingFinal?.();
  }

  private setStatus(status: ScribeStatus, detail?: string) {
    this.status = status;
    this.callbacks.onStatus(status, detail);
  }
}

/** Box-filter downsampling to 16 kHz, carrying the remainder between chunks. */
class Downsampler {
  private pending = new Float32Array(0);
  private pos = 0;

  constructor(private readonly ratio: number) {}

  process(input: Float32Array): Int16Array {
    const data = new Float32Array(this.pending.length + input.length);
    data.set(this.pending);
    data.set(input, this.pending.length);
    const ratio = Math.max(1, this.ratio);
    const out = new Int16Array(Math.max(0, Math.floor((data.length - this.pos) / ratio)));
    let pos = this.pos;
    let n = 0;
    while (n < out.length && pos + ratio <= data.length) {
      const a = Math.floor(pos);
      const b = Math.max(a + 1, Math.floor(pos + ratio));
      let sum = 0;
      for (let i = a; i < b; i++) sum += data[i]!;
      out[n++] = Math.max(-1, Math.min(1, sum / (b - a))) * 32767;
      pos += ratio;
    }
    const keep = Math.floor(pos);
    this.pending = data.slice(keep);
    this.pos = pos - keep;
    return out.subarray(0, n);
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
