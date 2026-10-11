// Face tracking on the phone: MediaPipe FaceLandmarker on the WebGL GPU delegate at ~15 fps,
// turned into per-frame features and a decimated, quantized mesh for the big screen.
import { CV_MAGIC, CV_QUANT, MESH_HEADER, MESH_MAGIC, MESH_POINTS, MESH_QUANT, type FaceFeatures } from '@deadpan/shared';
import type { FaceLandmarker, FaceLandmarkerOptions, FaceLandmarkerResult, NormalizedLandmark } from '@mediapipe/tasks-vision';
import { VENDOR } from '../vendor';
import { HeartRate } from './heart';

const TARGET_FPS = 15;
const BLINK_WINDOW_MS = 60_000;
/** PERCLOS, the share of time with the eyes shut, is taken over this window. */
const PERCLOS_WINDOW_MS = 30_000;
/** Landmarks in a full frame for the camera view, irises included. */
const FULL_LANDMARKS = 478;

export type Delegate = 'GPU' | 'CPU';
export interface LoadedLandmarker {
  landmarker: FaceLandmarker;
  delegate: Delegate;
}

let loading: Promise<LoadedLandmarker> | null = null;

/** Loads the wasm runtime and model once. Safe to call early, before the camera starts. */
export function loadFaceLandmarker(): Promise<LoadedLandmarker> {
  loading ??= (async () => {
    const { FaceLandmarker } = await import('@mediapipe/tasks-vision');
    const fileset = {
      wasmLoaderPath: `${VENDOR.mediapipe}vision_wasm_internal.js`,
      wasmBinaryPath: `${VENDOR.mediapipe}vision_wasm_internal.wasm`,
    };
    const options = (delegate: Delegate): FaceLandmarkerOptions => ({
      baseOptions: { modelAssetPath: VENDOR.faceModel, delegate },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
    });
    try {
      return { landmarker: await FaceLandmarker.createFromOptions(fileset, options('GPU')), delegate: 'GPU' as const };
    } catch (err) {
      console.warn('FaceLandmarker GPU delegate failed, falling back to CPU', err);
      return { landmarker: await FaceLandmarker.createFromOptions(fileset, options('CPU')), delegate: 'CPU' as const };
    }
  })();
  loading.catch(() => {
    loading = null; // Let the next call retry.
  });
  return loading;
}

export interface FaceStats {
  fps: number;
  inferMs: number;
  delegate: Delegate;
  errors: number;
  /** Raw per-frame values, for the debug overlay. */
  blinkScore: number;
  ear: number;
  jawOpen: number;
  /** Lowest eye aspect ratio since the last takeEarMin(), so a blink between packets still shows. */
  earMin: number;
  /** This player's open-eye aspect ratio, learned from clearly open frames. */
  earOpen: number;
  eyesClosed: boolean;
  lastBlinkMs: number;
  perclos: number;
  /** Head pose in degrees. */
  yaw: number;
  pitch: number;
  roll: number;
}

/** Runs the landmarker on a playing <video> and keeps the latest features and mesh. */
export class FaceTracker {
  readonly face: FaceFeatures = {
    present: false,
    blinkPm: 0,
    blinkCount: 0,
    lipPress: 0,
    brow: 0,
    gazeOff: 0,
    headMotion: 0,
    speaking: false,
  };
  readonly stats: FaceStats;
  /** Latest mesh frame, or null when no face is in view. */
  mesh: Int16Array<ArrayBuffer> | null = null;
  /** Bumped every time `mesh` changes, so senders can skip duplicates. */
  meshVersion = 0;
  /** Set while the big screen's camera view is open: every landmark, placed in the camera frame. */
  wantFull = false;
  full: Int16Array<ArrayBuffer> | null = null;
  /** Camera heart rate, from skin colour in the same frames. */
  readonly heart = new HeartRate();

  private readonly blinks = new BlinkCounter();
  private readonly lipPress = new Smoother(0.25);
  private readonly brow = new Smoother(0.25);
  private readonly gaze = new Smoother(0.3);
  private readonly motion = new Smoother(0.4);
  private readonly yaw = new Smoother(0.15);
  private readonly pitch = new Smoother(0.15);
  private readonly roll = new Smoother(0.15);
  private speakingLevel = 0;
  private prevMatrix: number[] | null = null;
  private prevFrameAt = 0;

  private stopped = false;
  private lastRunAt = 0;
  private lastTimestamp = 0;
  private frameTimes: number[] = [];

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly landmarker: FaceLandmarker,
    delegate: Delegate,
  ) {
    this.stats = {
      fps: 0,
      inferMs: 0,
      delegate,
      errors: 0,
      blinkScore: 0,
      ear: 0,
      jawOpen: 0,
      earMin: Infinity,
      earOpen: 0,
      eyesClosed: false,
      lastBlinkMs: 0,
      perclos: 0,
      yaw: 0,
      pitch: 0,
      roll: 0,
    };
    this.schedule();
  }

  stop() {
    this.stopped = true;
  }

  /** The lowest eye aspect ratio since the last call (the current one if no frame came in). */
  takeEarMin(): number {
    const min = Number.isFinite(this.stats.earMin) ? this.stats.earMin : this.stats.ear;
    this.stats.earMin = Infinity;
    return min;
  }

  private schedule() {
    if (this.stopped) return;
    if ('requestVideoFrameCallback' in this.video) this.video.requestVideoFrameCallback(this.onFrame);
    else requestAnimationFrame((now) => this.onFrame(now));
  }

  private readonly onFrame = (now: number) => {
    if (this.stopped) return;
    // The camera delivers ~30 fps; analysing every other frame gives ~15 fps.
    if (now - this.lastRunAt >= 1000 / TARGET_FPS - 4 && this.video.videoWidth > 0) {
      this.lastRunAt = now;
      // detectForVideo needs strictly increasing timestamps.
      const timestamp = Math.max(Math.round(now), this.lastTimestamp + 1);
      this.lastTimestamp = timestamp;
      const started = performance.now();
      try {
        this.process(this.landmarker.detectForVideo(this.video, timestamp), now);
      } catch (err) {
        if (this.stats.errors++ === 0) console.error('FaceLandmarker failed on a frame', err);
      }
      const took = performance.now() - started;
      this.stats.inferMs = this.stats.inferMs ? this.stats.inferMs * 0.9 + took * 0.1 : took;
      this.frameTimes.push(now);
      while (this.frameTimes.length > 0 && now - this.frameTimes[0]! > 2000) this.frameTimes.shift();
      this.stats.fps = this.frameTimes.length / 2;
    }
    this.schedule();
  };

  private process(result: FaceLandmarkerResult, now: number) {
    const landmarks = result.faceLandmarks[0];
    const categories = result.faceBlendshapes[0]?.categories;
    const dt = this.prevFrameAt ? Math.min(0.5, (now - this.prevFrameAt) / 1000) : 1 / TARGET_FPS;
    this.prevFrameAt = now;

    if (!landmarks || !categories) {
      this.face.present = false;
      this.face.speaking = false;
      this.face.blinkPm = this.blinks.perMinute(now);
      this.prevMatrix = null;
      this.full = null;
      if (this.mesh) {
        this.mesh = null;
        this.meshVersion++;
      }
      return;
    }

    const bs: Record<string, number> = {};
    for (const c of categories) bs[c.categoryName] = c.score;
    const s = (name: string) => bs[name] ?? 0;
    const w = this.video.videoWidth;
    const h = this.video.videoHeight;

    // Blinks: the blendshape alone fires when you look down at the phone, so it's
    // cross-checked against the eye aspect ratio from the landmarks.
    const blinkScore = (s('eyeBlinkLeft') + s('eyeBlinkRight')) / 2;
    const ear = (eyeAspectRatio(landmarks, RIGHT_EYE, w, h) + eyeAspectRatio(landmarks, LEFT_EYE, w, h)) / 2;
    this.blinks.update(now, blinkScore, ear, dt);

    // Gaze off-centre. "Out" on the left eye and "in" on the right eye both mean looking
    // towards the player's left.
    const horizontal = (s('eyeLookOutLeft') + s('eyeLookInRight') - s('eyeLookInLeft') - s('eyeLookOutRight')) / 2;
    const vertical = (s('eyeLookUpLeft') + s('eyeLookUpRight') - s('eyeLookDownLeft') - s('eyeLookDownRight')) / 2;

    // Speaking gate: hold the jaw-open peak for ~300 ms so syllable gaps don't flicker.
    const jawOpen = s('jawOpen');
    this.speakingLevel = Math.max(jawOpen, this.speakingLevel * Math.exp(-dt / 0.3));

    // Head motion: rotation (degrees) plus translation (cm) between frames, per second.
    const matrix = result.facialTransformationMatrixes?.[0]?.data;
    if (matrix && matrix.length === 16) {
      if (this.prevMatrix) this.motion.update(headMotion(this.prevMatrix, matrix) / dt, dt);
      this.prevMatrix = Array.from(matrix);
      const pose = headPose(matrix);
      this.stats.yaw = this.yaw.update(pose.yaw, dt);
      this.stats.pitch = this.pitch.update(pose.pitch, dt);
      this.stats.roll = this.roll.update(pose.roll, dt);
    }

    this.face.present = true;
    this.face.blinkPm = this.blinks.perMinute(now);
    this.face.blinkCount = this.blinks.total;
    this.face.lipPress = this.lipPress.update((s('mouthPressLeft') + s('mouthPressRight') + s('mouthRollLower')) / 3, dt);
    this.face.brow = this.brow.update(s('browInnerUp'), dt);
    this.face.gazeOff = this.gaze.update(Math.min(1, Math.hypot(horizontal, vertical)), dt);
    this.face.headMotion = this.motion.value;
    this.face.speaking = this.speakingLevel > 0.1;

    this.stats.blinkScore = blinkScore;
    this.stats.ear = ear;
    this.stats.earMin = Math.min(this.stats.earMin, ear);
    this.stats.earOpen = this.blinks.openEar;
    this.stats.eyesClosed = this.blinks.closed;
    this.stats.lastBlinkMs = this.blinks.lastBlinkMs;
    this.stats.perclos = this.blinks.perclos;
    this.stats.jawOpen = jawOpen;

    this.mesh = quantizeMesh(landmarks, w, h);
    this.full = this.wantFull ? quantizeFull(landmarks) : null;
    this.meshVersion++;
    this.heart.addFrame(this.video, landmarks, now, this.motion.value);
  }
}

// Eye landmarks as [corner, corner, top1, bottom1, top2, bottom2].
const RIGHT_EYE = [33, 133, 160, 144, 158, 153] as const;
const LEFT_EYE = [362, 263, 385, 380, 387, 373] as const;

function eyeAspectRatio(lm: NormalizedLandmark[], eye: readonly number[], w: number, h: number): number {
  const d = (a: number, b: number) => Math.hypot((lm[a]!.x - lm[b]!.x) * w, (lm[a]!.y - lm[b]!.y) * h);
  const width = d(eye[0]!, eye[1]!);
  return width > 0 ? (d(eye[2]!, eye[3]!) + d(eye[4]!, eye[5]!)) / (2 * width) : 0;
}

/** Degrees of rotation plus centimetres of translation between two 4x4 column-major poses. */
function headMotion(a: ArrayLike<number>, b: ArrayLike<number>): number {
  // trace(Rb · Raᵀ) is the element-wise dot product of the two rotation blocks.
  let trace = 0;
  for (let col = 0; col < 3; col++) for (let row = 0; row < 3; row++) trace += a[col * 4 + row]! * b[col * 4 + row]!;
  const degrees = (Math.acos(Math.min(1, Math.max(-1, (trace - 1) / 2))) * 180) / Math.PI;
  const cm = Math.hypot(b[12]! - a[12]!, b[13]! - a[13]!, b[14]! - a[14]!);
  return degrees + cm;
}

/**
 * Turn, nod and tilt in degrees from a 4x4 column-major pose. The camera space has y up and looks
 * down −z, so yaw is positive when the face points to the image's right and pitch when it looks up.
 */
function headPose(m: ArrayLike<number>): { yaw: number; pitch: number; roll: number } {
  // r(row, col) of the rotation block.
  const r = (row: number, col: number) => m[col * 4 + row]!;
  const deg = 180 / Math.PI;
  return {
    yaw: Math.asin(Math.max(-1, Math.min(1, r(0, 2)))) * deg,
    pitch: Math.atan2(r(1, 2), r(2, 2)) * deg,
    roll: Math.atan2(r(1, 0), r(0, 0)) * deg,
  };
}

/** Every landmark as a fraction of the camera frame, packed as int16 for the camera view. */
function quantizeFull(lm: NormalizedLandmark[]): Int16Array<ArrayBuffer> {
  const out = new Int16Array(MESH_HEADER + FULL_LANDMARKS * 3);
  out[0] = CV_MAGIC;
  const q = (v: number) => Math.max(-32767, Math.min(32767, Math.round(v * CV_QUANT)));
  for (let i = 0; i < Math.min(FULL_LANDMARKS, lm.length); i++) {
    const p = lm[i]!;
    out[MESH_HEADER + i * 3] = q(p.x);
    out[MESH_HEADER + i * 3 + 1] = q(p.y);
    out[MESH_HEADER + i * 3 + 2] = q(p.z);
  }
  return out;
}

/** Centres the streamed landmarks on the face, scales by its size and packs them as int16. */
function quantizeMesh(lm: NormalizedLandmark[], w: number, h: number): Int16Array<ArrayBuffer> {
  const n = MESH_POINTS.length;
  const xyz = new Float32Array(n * 3);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < n; i++) {
    const p = lm[MESH_POINTS[i]!]!;
    // Pixel units, so x and y share a scale. MediaPipe's z uses the same scale as x.
    const x = p.x * w, y = p.y * h, z = p.z * w;
    xyz[i * 3] = x;
    xyz[i * 3 + 1] = y;
    xyz[i * 3 + 2] = z;
    cx += x; cy += y; cz += z;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  cx /= n; cy /= n; cz /= n;
  const scale = Math.max(maxX - minX, maxY - minY, 1);
  const out = new Int16Array(MESH_HEADER + n * 3);
  out[0] = MESH_MAGIC;
  const c = [cx, cy, cz];
  for (let i = 0; i < n * 3; i++) {
    out[MESH_HEADER + i] = Math.max(-32767, Math.min(32767, Math.round(((xyz[i]! - c[i % 3]!) / scale) * MESH_QUANT)));
  }
  return out;
}

/**
 * Counts blinks over the last minute, using the blendshape score and the eye aspect ratio. Also
 * keeps PERCLOS, the share of the last 30 s with the eyes shut, which long closures dominate.
 */
class BlinkCounter {
  /** Every blink since tracking started. */
  total = 0;
  closed = false;
  openEar = 0;
  lastBlinkMs = 0;
  perclos = 0;
  private closedAt = 0;
  private readonly startedAt = performance.now();
  private readonly events: number[] = [];
  /** [time, frame length in ms, eyes shut] for PERCLOS. */
  private readonly frames: [number, number, boolean][] = [];
  private framesMs = 0;
  private closedMs = 0;

  update(now: number, score: number, ear: number, dt: number) {
    // Learn what this player's open eye looks like, only from clearly open frames.
    if (!this.closed && score < 0.3 && ear > 0) this.openEar = this.openEar ? this.openEar * 0.97 + ear * 0.03 : ear;
    const earClosed = this.openEar > 0 && ear < this.openEar * 0.72;
    if (!this.closed && score > 0.5 && earClosed) {
      this.closed = true;
      this.closedAt = now;
    } else if (this.closed && (score < 0.35 || ear > this.openEar * 0.85)) {
      this.closed = false;
      // Longer than half a second is eyes shut, not a blink.
      if (now - this.closedAt <= 500) {
        this.events.push(now);
        this.total++;
        this.lastBlinkMs = now - this.closedAt;
      }
    }
    while (this.events.length > 0 && now - this.events[0]! > BLINK_WINDOW_MS) this.events.shift();

    const ms = dt * 1000;
    this.frames.push([now, ms, this.closed]);
    this.framesMs += ms;
    if (this.closed) this.closedMs += ms;
    while (this.frames.length > 0 && now - this.frames[0]![0] > PERCLOS_WINDOW_MS) {
      const [, oldMs, wasClosed] = this.frames.shift()!;
      this.framesMs -= oldMs;
      if (wasClosed) this.closedMs -= oldMs;
    }
    this.perclos = this.framesMs > 0 ? Math.max(0, this.closedMs / this.framesMs) : 0;
  }

  perMinute(now: number): number {
    // Until a full minute has passed, scale by the time observed (at least 10 s).
    const window = Math.min(BLINK_WINDOW_MS, Math.max(10_000, now - this.startedAt));
    return (this.events.length * 60_000) / window;
  }
}

/** Exponential smoothing with a time constant in seconds, independent of frame rate. */
class Smoother {
  value = 0;
  private primed = false;

  constructor(private readonly tau: number) {}

  update(x: number, dt: number): number {
    if (!this.primed) {
      this.value = x;
      this.primed = true;
    } else {
      this.value += (x - this.value) * (1 - Math.exp(-dt / this.tau));
    }
    return this.value;
  }
}
