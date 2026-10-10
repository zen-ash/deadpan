// Camera heart rate (decorative, never used in the verdict): the POS method (Wang et al. 2017) on
// the average skin colour of the forehead and cheeks, found from the face landmarks.
// Samples are resampled to 30 Hz; over a 15 s window the strongest frequency in 0.7–3.5 Hz is the
// pulse, and signal quality is that peak's share of the band's power.
import type { NormalizedLandmark } from '@mediapipe/tasks-vision';

const FS = 30;
const WINDOW_MS = 15_000;
/** Don't report anything until this much signal has been collected. */
const MIN_MS = 8_000;
const BAND_HZ = [0.7, 3.5] as const;
const FREQ_STEP_HZ = 0.02;
/** POS projects colour over short overlapping windows (1.6 s). */
const POS_WINDOW = Math.round(1.6 * FS);
/** Below this share of band power the "peak" is just noise. */
const MIN_QUALITY = 0.3;
/** Head motion (degrees + cm per second) above which the colour signal is meaningless. */
const MAX_MOTION = 20;
/** The video is analysed at a quarter of its size: averaging pixels is the point anyway. */
const SCALE = 0.25;

// Skin patches: above the brows, and the middle of each cheek.
const REGIONS = [
  [151, 108, 337, 107, 336, 9],
  [50, 101, 118, 117, 123, 187, 205, 36],
  [280, 330, 347, 346, 352, 411, 425, 266],
];

export interface Rgb {
  t: number;
  r: number;
  g: number;
  b: number;
}

export class HeartRate {
  bpm: number | null = null;
  quality = 0;
  private readonly canvas = document.createElement('canvas');
  private readonly ctx = this.canvas.getContext('2d', { willReadFrequently: true });
  private samples: Rgb[] = [];
  private lastComputeAt = 0;

  /** Adds one analysed video frame. `motion` is the face tracker's head motion. */
  addFrame(video: HTMLVideoElement, landmarks: NormalizedLandmark[], now: number, motion: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const w = Math.max(1, Math.round(video.videoWidth * SCALE));
    const h = Math.max(1, Math.round(video.videoHeight * SCALE));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    ctx.drawImage(video, 0, 0, w, h);
    const pixels = ctx.getImageData(0, 0, w, h).data;

    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (const region of REGIONS) {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const i of region) {
        const p = landmarks[i];
        if (!p) continue;
        x0 = Math.min(x0, p.x);
        x1 = Math.max(x1, p.x);
        y0 = Math.min(y0, p.y);
        y1 = Math.max(y1, p.y);
      }
      // Shrink each box a little so it stays on skin.
      const padX = (x1 - x0) * 0.15;
      const padY = (y1 - y0) * 0.15;
      const left = Math.max(0, Math.floor((x0 + padX) * w));
      const right = Math.min(w - 1, Math.ceil((x1 - padX) * w));
      const top = Math.max(0, Math.floor((y0 + padY) * h));
      const bottom = Math.min(h - 1, Math.ceil((y1 - padY) * h));
      for (let y = top; y <= bottom; y++) {
        for (let x = left; x <= right; x++) {
          const o = (y * w + x) * 4;
          r += pixels[o]!;
          g += pixels[o + 1]!;
          b += pixels[o + 2]!;
          n++;
        }
      }
    }
    if (n === 0) return;
    this.samples.push({ t: now, r: r / n, g: g / n, b: b / n });
    while (this.samples.length > 0 && now - this.samples[0]!.t > WINDOW_MS) this.samples.shift();

    if (now - this.lastComputeAt >= 1000) {
      this.lastComputeAt = now;
      const estimate = estimatePulse(this.samples);
      this.quality = estimate?.quality ?? 0;
      if (!estimate || estimate.quality < MIN_QUALITY || motion > MAX_MOTION) {
        this.bpm = null;
      } else {
        // Smooth, but jump straight to a new value that's far from the old one.
        const bpm = estimate.bpm;
        this.bpm = this.bpm === null || Math.abs(bpm - this.bpm) > 25 ? bpm : this.bpm * 0.7 + bpm * 0.3;
      }
    }
  }

  /** Forget everything, e.g. when the face is lost. */
  reset() {
    this.samples = [];
    this.bpm = null;
    this.quality = 0;
  }
}

/** The pulse in a run of skin-colour samples, or null if there isn't enough signal yet. */
export function estimatePulse(samples: Rgb[]): { bpm: number; quality: number } | null {
  const first = samples[0];
  const last = samples.at(-1);
  if (!first || !last || last.t - first.t < MIN_MS) return null;

  // Resample to a steady 30 Hz.
  const n = Math.floor(((last.t - first.t) / 1000) * FS);
  const rgb = { r: new Float64Array(n), g: new Float64Array(n), b: new Float64Array(n) };
  let j = 0;
  for (let i = 0; i < n; i++) {
    const t = first.t + (i * 1000) / FS;
    while (j < samples.length - 2 && samples[j + 1]!.t < t) j++;
    const a = samples[j]!;
    const c = samples[j + 1]!;
    const k = c.t > a.t ? Math.min(1, Math.max(0, (t - a.t) / (c.t - a.t))) : 0;
    rgb.r[i] = a.r + (c.r - a.r) * k;
    rgb.g[i] = a.g + (c.g - a.g) * k;
    rgb.b[i] = a.b + (c.b - a.b) * k;
  }

  // POS: per window, normalise each channel by its mean, project onto two chrominance axes
  // (G − B and G + B − 2R), combine them to cancel motion and light changes, overlap-add.
  const pulse = new Float64Array(n);
  for (let m = 0; m + POS_WINDOW <= n; m++) {
    let mr = 0, mg = 0, mb = 0;
    for (let i = m; i < m + POS_WINDOW; i++) {
      mr += rgb.r[i]!;
      mg += rgb.g[i]!;
      mb += rgb.b[i]!;
    }
    mr /= POS_WINDOW;
    mg /= POS_WINDOW;
    mb /= POS_WINDOW;
    if (mr === 0 || mg === 0 || mb === 0) continue;
    const s1 = new Float64Array(POS_WINDOW);
    const s2 = new Float64Array(POS_WINDOW);
    for (let i = 0; i < POS_WINDOW; i++) {
      const rn = rgb.r[m + i]! / mr;
      const gn = rgb.g[m + i]! / mg;
      const bn = rgb.b[m + i]! / mb;
      s1[i] = gn - bn;
      s2[i] = gn + bn - 2 * rn;
    }
    const sd2 = std(s2);
    const alpha = sd2 > 0 ? std(s1) / sd2 : 0;
    const h = s1.map((v, i) => v + alpha * s2[i]!);
    const hm = mean(h);
    for (let i = 0; i < POS_WINDOW; i++) pulse[m + i]! += h[i]! - hm;
  }

  // Power spectrum over the heart-rate band only, with a Hann window.
  const pm = mean(pulse);
  const windowed = pulse.map((v, i) => (v - pm) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1))));
  let total = 0;
  let peakPower = 0;
  let peakHz = 0;
  const powers: { hz: number; p: number }[] = [];
  for (let hz = BAND_HZ[0]; hz <= BAND_HZ[1]; hz += FREQ_STEP_HZ) {
    let re = 0;
    let im = 0;
    const w = (2 * Math.PI * hz) / FS;
    for (let i = 0; i < n; i++) {
      re += windowed[i]! * Math.cos(w * i);
      im -= windowed[i]! * Math.sin(w * i);
    }
    const p = re * re + im * im;
    powers.push({ hz, p });
    total += p;
    if (p > peakPower) {
      peakPower = p;
      peakHz = hz;
    }
  }
  // Quality: power within ±0.1 Hz of the peak, as a share of the whole band.
  const near = powers.filter((x) => Math.abs(x.hz - peakHz) <= 0.1).reduce((a, x) => a + x.p, 0);
  return { bpm: peakHz * 60, quality: total > 0 ? near / total : 0 };
}

function mean(xs: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += xs[i]!;
  return xs.length > 0 ? s / xs.length : 0;
}

function std(xs: ArrayLike<number>): number {
  const m = mean(xs);
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += (xs[i]! - m) ** 2;
  return xs.length > 1 ? Math.sqrt(s / (xs.length - 1)) : 0;
}
