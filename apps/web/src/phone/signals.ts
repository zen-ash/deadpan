// Ties face and voice analysis together and streams them to the server at 10 Hz.
import { FEATURE_HZ, type ClientToServer, type FeaturesPacket } from '@deadpan/shared';
import { FaceTracker, type LoadedLandmarker } from './face';
import { VoiceAnalyser } from './voice';

/** Below this face-tracking rate with Silero running, Silero is swapped for the RMS detector. */
const MIN_FPS_WITH_SILERO = 12;

export interface SignalSink {
  send(msg: ClientToServer): void;
  sendBinary(data: Int16Array<ArrayBuffer>): void;
}

export interface SignalOptions {
  /** 'rms' skips loading Silero (also settable with ?vad=rms). */
  vad?: 'silero' | 'rms';
}

export class PhoneSignals {
  readonly voice: VoiceAnalyser;
  face: FaceTracker | null = null;
  faceError = '';
  packetsPerSecond = 0;
  lastPacket: FeaturesPacket | null = null;

  private readonly timer: number;
  private readonly watchdog: number;
  private sentMeshVersion = -1;
  private packetTimes: number[] = [];
  private sileroSince = 0;
  private slowSeconds = 0;
  private stopped = false;

  constructor(
    video: HTMLVideoElement,
    audioCtx: AudioContext,
    analyser: AnalyserNode,
    stream: MediaStream,
    landmarker: Promise<LoadedLandmarker>,
    private readonly sink: SignalSink,
    options: SignalOptions = {},
  ) {
    this.voice = new VoiceAnalyser(audioCtx, analyser, stream, {
      onSpeechStart: (at) => sink.send({ t: 'speech_onset', ts: at }),
      onSpeechEnd: (at) => sink.send({ t: 'speech_end', ts: at }),
    });

    landmarker.then(
      ({ landmarker, delegate }) => {
        if (!this.stopped) this.face = new FaceTracker(video, landmarker, delegate);
      },
      (err: unknown) => {
        this.faceError = err instanceof Error ? err.message : String(err);
        sink.send({ t: 'diag', msg: `face tracker failed to load: ${this.faceError}` });
      },
    );

    if (options.vad === 'rms') this.voice.vadNote = 'forced by ?vad=rms';
    else void this.voice.startSilero();

    this.timer = window.setInterval(this.sendPacket, 1000 / FEATURE_HZ);
    this.watchdog = window.setInterval(this.checkSpeed, 1000);
  }

  stop() {
    this.stopped = true;
    clearInterval(this.timer);
    clearInterval(this.watchdog);
    this.face?.stop();
    this.voice.stop();
  }

  private readonly sendPacket = () => {
    const now = Date.now();
    const face = this.face;
    const voice = this.voice.takeWindow();
    const packet: FeaturesPacket = {
      ts: now,
      fps: face?.stats.fps ?? 0,
      face: face ? { ...face.face } : { present: false, blinkPm: 0, lipPress: 0, brow: 0, gazeOff: 0, headMotion: 0, speaking: false },
      voice: { pitchHz: voice.pitchHz, clarity: voice.clarity, vad: this.voice.speaking, rms: voice.rms },
      // Camera heart rate isn't built yet; it's decorative and never used in the verdict.
      hr: { bpm: null, quality: 0 },
    };
    this.sink.send({ t: 'features', ...packet });
    this.lastPacket = packet;

    if (face?.mesh && face.meshVersion !== this.sentMeshVersion) {
      this.sentMeshVersion = face.meshVersion;
      this.sink.sendBinary(face.mesh);
    }

    this.packetTimes.push(now);
    while (this.packetTimes.length > 0 && now - this.packetTimes[0]! > 2000) this.packetTimes.shift();
    this.packetsPerSecond = this.packetTimes.length / 2;
  };

  /** SPEC: if Silero next to MediaPipe drops the phone below ~12 fps, use the RMS detector. */
  private readonly checkSpeed = () => {
    if (this.voice.vadMode !== 'silero' || !this.face) {
      this.sileroSince = 0;
      this.slowSeconds = 0;
      return;
    }
    this.sileroSince ||= Date.now();
    // Give it a few seconds to settle after loading.
    if (Date.now() - this.sileroSince < 5000) return;
    // A hidden page or a paused camera delivers no frames at all; that isn't Silero's fault.
    if (document.visibilityState !== 'visible' || this.face.stats.fps === 0) {
      this.slowSeconds = 0;
      return;
    }
    this.slowSeconds = this.face.stats.fps < MIN_FPS_WITH_SILERO ? this.slowSeconds + 1 : 0;
    if (this.slowSeconds >= 5) {
      const reason = `face tracking at ${this.face.stats.fps.toFixed(1)} fps with Silero`;
      void this.voice.useRms(reason);
      this.sink.send({ t: 'diag', msg: `switched to RMS speech detection: ${reason}` });
    }
  };
}
