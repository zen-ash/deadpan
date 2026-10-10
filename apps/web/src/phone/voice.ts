// Voice analysis on the phone: pitch with pitchy, loudness and a noise floor, and speech
// onset/end. Speech detection starts on a loudness threshold above the noise floor and moves
// to Silero (vad-web) once that has loaded, unless the face tracker can't keep up with it.
import type { MicVAD } from '@ricky0123/vad-web';
import { PitchDetector } from 'pitchy';
import { VENDOR } from '../vendor';

const TICK_MS = 40;
const MIN_PITCH_HZ = 70;
const MAX_PITCH_HZ = 400;
const MIN_CLARITY = 0.9;

export type VadMode = 'rms' | 'loading' | 'silero';

export interface VoiceCallbacks {
  /** `at` is a Date.now() timestamp for when speech actually began or ended. */
  onSpeechStart(at: number): void;
  onSpeechEnd(at: number): void;
}

export interface VoiceWindow {
  /** Median pitch of the clear voiced frames since the last call, or null. */
  pitchHz: number | null;
  clarity: number;
  rms: number;
}

export class VoiceAnalyser {
  /** Silero is kept as the source of truth while it's healthy, RMS otherwise. */
  vadMode: VadMode = 'rms';
  speaking = false;
  rms = 0;
  noiseFloor = 0;
  /** Most recent clear pitch, cleared after half a second without one. */
  lastPitchHz: number | null = null;
  lastClarity = 0;
  /** Why Silero isn't in use, if it isn't. */
  vadNote = '';

  private readonly buffer: Float32Array<ArrayBuffer>;
  private readonly detector: PitchDetector<Float32Array<ArrayBuffer>>;
  private readonly timer: number;
  private pitches: number[] = [];
  private clarityMax = 0;
  private rmsSum = 0;
  private rmsCount = 0;
  private lastPitchAt = 0;
  private readonly rmsVad = new RmsVad();
  private silero: MicVAD | null = null;
  private sileroPendingStart: number | null = null;
  private stopped = false;

  constructor(
    private readonly audioCtx: AudioContext,
    private readonly analyser: AnalyserNode,
    private readonly stream: MediaStream,
    private readonly callbacks: VoiceCallbacks,
  ) {
    this.buffer = new Float32Array(analyser.fftSize);
    this.detector = PitchDetector.forFloat32Array(analyser.fftSize);
    this.detector.minVolumeDecibels = -60;
    this.timer = window.setInterval(this.tick, TICK_MS);
  }

  private readonly tick = () => {
    this.analyser.getFloatTimeDomainData(this.buffer);
    let sum = 0;
    for (const v of this.buffer) sum += v * v;
    const rms = Math.sqrt(sum / this.buffer.length);
    this.rms = rms;
    this.rmsSum += rms;
    this.rmsCount++;

    // Noise floor: drops quickly to quiet moments, creeps up slowly, and ignores speech.
    if (!this.speaking) {
      const tau = rms < this.noiseFloor || this.noiseFloor === 0 ? 0.5 : 15;
      this.noiseFloor = this.noiseFloor === 0 ? rms : this.noiseFloor + (rms - this.noiseFloor) * (1 - Math.exp(-TICK_MS / 1000 / tau));
    }

    const [pitch, clarity] = this.detector.findPitch(this.buffer, this.audioCtx.sampleRate);
    this.lastClarity = clarity;
    if (clarity >= MIN_CLARITY && pitch >= MIN_PITCH_HZ && pitch <= MAX_PITCH_HZ) {
      this.pitches.push(pitch);
      this.lastPitchHz = pitch;
      this.lastPitchAt = performance.now();
    } else if (performance.now() - this.lastPitchAt > 500) {
      this.lastPitchHz = null;
    }
    this.clarityMax = Math.max(this.clarityMax, clarity);

    if (this.vadMode !== 'silero') {
      const event = this.rmsVad.update(Date.now(), rms, this.noiseFloor);
      if (event) this.setSpeaking(event.speaking, event.at);
    }
  };

  /** Summary of the audio since the last call; called once per features packet. */
  takeWindow(): VoiceWindow {
    const sorted = this.pitches.sort((a, b) => a - b);
    const window: VoiceWindow = {
      pitchHz: sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)]! : null,
      clarity: this.clarityMax,
      rms: this.rmsCount > 0 ? this.rmsSum / this.rmsCount : this.rms,
    };
    this.pitches = [];
    this.clarityMax = 0;
    this.rmsSum = 0;
    this.rmsCount = 0;
    return window;
  }

  /** Loads Silero VAD in the background and switches to it once it's running. */
  async startSilero() {
    if (this.silero || this.vadMode === 'loading') return;
    this.vadMode = 'loading';
    try {
      const { MicVAD } = await import('@ricky0123/vad-web');
      const vad = await MicVAD.new({
        model: 'v5',
        audioContext: this.audioCtx,
        // Reuse the one stream from the single getUserMedia call, and never stop its tracks.
        getStream: async () => this.stream,
        pauseStream: async () => {},
        resumeStream: async (stream) => stream,
        baseAssetPath: VENDOR.vad,
        onnxWASMBasePath: VENDOR.ort,
        // Stricter than the defaults (0.3 / 0.25 / 400 ms), to ignore chatter around the table.
        positiveSpeechThreshold: 0.6,
        negativeSpeechThreshold: 0.45,
        minSpeechMs: 200,
        redemptionMs: 500,
        preSpeechPadMs: 0,
        startOnLoad: true,
        ortConfig: (ort) => {
          ort.env.logLevel = 'error';
          ort.env.wasm.numThreads = 1;
        },
        // onSpeechStart fires on the first speech frame (32 ms). It only counts once
        // onSpeechRealStart confirms it lasted minSpeechMs.
        onSpeechStart: () => {
          this.sileroPendingStart = Date.now() - 32;
        },
        onSpeechRealStart: () => {
          if (this.vadMode === 'silero') this.setSpeaking(true, this.sileroPendingStart ?? Date.now());
        },
        onVADMisfire: () => {
          this.sileroPendingStart = null;
        },
        onSpeechEnd: () => {
          if (this.vadMode === 'silero') this.setSpeaking(false, Date.now() - 500);
        },
      });
      if (this.stopped) {
        await vad.destroy();
        return;
      }
      this.silero = vad;
      this.vadMode = 'silero';
      this.vadNote = '';
      // Close any speech the RMS detector had open, so onsets and ends stay paired.
      if (this.speaking) this.setSpeaking(false, Date.now());
    } catch (err) {
      console.warn('Silero VAD failed to load; staying on the RMS detector', err);
      this.vadMode = 'rms';
      this.vadNote = 'silero failed to load';
    }
  }

  /** Falls back to the RMS detector for good, e.g. when face tracking gets too slow. */
  async useRms(reason: string) {
    this.vadNote = reason;
    const vad = this.silero;
    this.silero = null;
    this.vadMode = 'rms';
    if (this.speaking) this.setSpeaking(false, Date.now());
    await vad?.destroy();
  }

  stop() {
    this.stopped = true;
    clearInterval(this.timer);
    void this.silero?.destroy();
    this.silero = null;
  }

  private setSpeaking(speaking: boolean, at: number) {
    if (speaking === this.speaking) return;
    this.speaking = speaking;
    if (speaking) this.callbacks.onSpeechStart(at);
    else this.callbacks.onSpeechEnd(at);
  }
}

/** Speech is loudness 10 dB over the noise floor for 150 ms; it ends after 400 ms below. */
class RmsVad {
  private speaking = false;
  private aboveSince: number | null = null;
  private lastAbove = 0;

  update(now: number, rms: number, noiseFloor: number): { speaking: boolean; at: number } | null {
    const threshold = Math.max(noiseFloor * 3.16, 0.004);
    const above = rms > (this.speaking ? threshold * 0.7 : threshold);
    if (above) {
      this.lastAbove = now;
      this.aboveSince ??= now;
      if (!this.speaking && now - this.aboveSince >= 150) {
        this.speaking = true;
        return { speaking: true, at: this.aboveSince };
      }
    } else {
      this.aboveSince = null;
      if (this.speaking && now - this.lastAbove >= 400) {
        this.speaking = false;
        return { speaking: false, at: this.lastAbove };
      }
    }
    return null;
  }
}
