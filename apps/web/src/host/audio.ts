// The big screen's sound: the detective's lines (streamed MP3s, played in order) and the sound
// effects and room tone (decoded once, played through Web Audio). Browsers only allow sound after
// a click, so unlock() runs from the Start round button.
import { SFX_NAMES, type SfxName, type SpokenLine } from '@deadpan/shared';
import { speakLine } from './speech';

/** A line that hasn't started playing after this long is read by the laptop voice instead. */
const STALL_MS = 4000;
/** A line whose playback stops moving for this long (a stream that hung) is skipped, so it can't block the lines after it. */
const STUCK_MS = 5000;
const SFX_GAIN = 0.8;
const ROOM_TONE_GAIN = 0.18;

interface Queued {
  line: SpokenLine;
  /** Called with the Date.now() the line finished. */
  onEnd: (at: number) => void;
}

export class HostAudio {
  unlocked = false;
  /** Set when a line was blocked because the page hasn't been clicked yet. */
  onBlocked?: () => void;

  private readonly el = new Audio();
  private ctx: AudioContext | null = null;
  private readonly buffers = new Map<SfxName, AudioBuffer>();
  private roomTone: { source: AudioBufferSourceNode; gain: GainNode } | null = null;
  private wantRoomTone = false;
  private readonly queue: Queued[] = [];
  private current: { item: Queued; finish: () => void; stop: () => void } | null = null;

  constructor() {
    this.el.preload = 'auto';
  }

  /** Call from a click: lets the page play sound from now on, and loads the sound effects. */
  unlock() {
    this.ctx ??= new AudioContext();
    void this.ctx.resume();
    if (!this.unlocked) {
      // Playing anything from inside the click marks this element as allowed (Safari needs this).
      this.el.src = silentWav();
      void this.el.play().catch(() => {});
      void this.loadSfx();
    }
    this.unlocked = true;
    if (this.wantRoomTone) this.setRoomTone(true);
  }

  say(line: SpokenLine, onEnd: (at: number) => void) {
    this.queue.push({ line, onEnd });
    if (!this.current) this.next();
  }

  /** Drops everything queued and stops the current line (the round ended). */
  stopLines() {
    this.queue.length = 0;
    this.current?.stop();
    this.el.pause();
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    this.current = null;
  }

  sfx(name: SfxName) {
    const buffer = this.buffers.get(name);
    if (!buffer || !this.ctx) return;
    const source = this.ctx.createBufferSource();
    const gain = this.ctx.createGain();
    source.buffer = buffer;
    gain.gain.value = SFX_GAIN;
    source.connect(gain).connect(this.ctx.destination);
    source.start();
  }

  /** The noir room tone, looping quietly under a round. */
  setRoomTone(on: boolean) {
    this.wantRoomTone = on;
    const ctx = this.ctx;
    if (on && !this.roomTone && ctx && this.buffers.has('roomtone')) {
      const source = ctx.createBufferSource();
      const gain = ctx.createGain();
      source.buffer = this.buffers.get('roomtone')!;
      source.loop = true;
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(ROOM_TONE_GAIN, ctx.currentTime + 2);
      source.connect(gain).connect(ctx.destination);
      source.start();
      this.roomTone = { source, gain };
    } else if (!on && this.roomTone && ctx) {
      const { source, gain } = this.roomTone;
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 1);
      source.stop(ctx.currentTime + 1.1);
      this.roomTone = null;
    }
  }

  private next() {
    const item = this.queue.shift();
    if (!item) return;
    let finished = false;
    let stall: number | undefined;
    let lastTime = -1;
    let lastMoveAt = Date.now();
    const watch = window.setInterval(() => {
      if (this.el.currentTime !== lastTime) {
        lastTime = this.el.currentTime;
        lastMoveAt = Date.now();
      } else if (!this.el.paused && Date.now() - lastMoveAt > STUCK_MS) {
        console.warn('A detective line stopped mid-way; skipping it.');
        finish();
      }
    }, 1000);
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(stall);
      clearInterval(watch);
      this.el.onended = null;
      this.el.onerror = null;
      this.el.onplaying = null;
      if (this.current?.item === item) this.current = null;
      item.onEnd(Date.now());
      if (!this.current) this.next();
    };
    // The audio couldn't play (ElevenLabs down, network, autoplay): read the line aloud instead.
    const fallback = () => {
      if (finished) return;
      clearTimeout(stall);
      clearInterval(watch);
      this.el.onended = null;
      this.el.onerror = null;
      this.el.pause();
      void speakLine(item.line.text).then(finish);
    };
    // Dropped without reporting an end: the round it belonged to is over.
    const stop = () => {
      finished = true;
      clearTimeout(stall);
      clearInterval(watch);
    };
    this.current = { item, finish, stop };
    this.el.onended = finish;
    this.el.onerror = fallback;
    this.el.onplaying = () => clearTimeout(stall);
    this.el.src = item.line.url;
    stall = window.setTimeout(fallback, STALL_MS);
    this.el.play().catch((err: unknown) => {
      if (err instanceof DOMException && err.name === 'NotAllowedError') this.onBlocked?.();
      fallback();
    });
  }

  private async loadSfx() {
    const ctx = this.ctx;
    if (!ctx) return;
    await Promise.all(
      SFX_NAMES.map(async (name) => {
        try {
          const res = await fetch(`/api/sfx/${name}.mp3`, { signal: AbortSignal.timeout(15_000) });
          if (!res.ok) return;
          this.buffers.set(name, await ctx.decodeAudioData(await res.arrayBuffer()));
        } catch {
          // A missing sound effect just means silence there.
        }
      }),
    );
    if (this.wantRoomTone) this.setRoomTone(true);
  }
}

/** A 50 ms silent WAV, for unlocking the audio element inside a click. */
function silentWav(): string {
  const samples = 400;
  const bytes = new Uint8Array(44 + samples);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, s: string) => [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples, true);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, 8000, true);
  view.setUint32(28, 8000, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  text(36, 'data');
  view.setUint32(40, samples, true);
  bytes.fill(128, 44);
  return URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
}
