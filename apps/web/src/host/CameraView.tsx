// The big screen's camera view, for the computer vision judges: what each phone's vision pipeline
// sees, live. Every landmark sits where it is in the camera frame, with the detections drawn on
// it: blinks on the eyes, lip press on the mouth, head pose from the nose, and the skin patches
// the pulse is read from. No video ever leaves the phones; these numbers are all they send.
import { MESH_EDGES, MESH_POINTS, PULSE_REGIONS, type FeaturesPacket, type PlayerInfo } from '@deadpan/shared';
import { FACE_PARTS, FACE_TESSELATION } from '@deadpan/shared/face';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { HISTORY_MS, live, useLivePlayer, type HistoryPoint, type LivePlayer } from './live';

const GAP = 16;
/** Eyes count as shut below this share of the player's open-eye aspect ratio (as on the phone). */
const EYES_SHUT = 0.72;
/** PERCLOS above this over 30 s is the usual drowsiness threshold. */
const DROWSY_PERCLOS = 0.15;
/** Heart-rate quality the phone needs before it reports a pulse. */
const PULSE_MIN_QUALITY = 0.3;
const CREAM = '243, 230, 196';
const CORAL = '240, 138, 120';
const GREEN = '127, 199, 154';

interface Props {
  players: PlayerInfo[];
  /** Whoever is being questioned gets the gold border. */
  activeId: string | null;
  /** Where the game is, e.g. "Ash is answering". */
  status: string;
  /** Demo mode: a recording keeps the lighter mesh and the signals, not the full landmarks. */
  replay?: boolean;
  onClose: () => void;
}

export function CameraView({ players, activeId, status, replay = false, onClose }: Props) {
  const gridRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1200, h: 640 });
  useLayoutEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const grid = gridFor(players.length, size.w, size.h);

  return (
    <section className="camview" role="dialog" aria-label="Camera view">
      <header className="camview-head">
        <div>
          <p className="eyebrow camview-eyebrow">Camera view</p>
          <h1 className="camview-title">What each phone sees.</h1>
          <p className="camview-sub">
            {replay
              ? 'This is a recording, so it shows the lighter mesh and the signals as saved. Live phones send all 478 landmarks.'
              : 'Face tracking runs on each phone, about 15 times a second. Only these landmarks and numbers leave it, never video.'}
          </p>
        </div>
        <div className="camview-actions">
          <span className="camview-status">{status}</span>
          <button className="btn glass" onClick={onClose}>
            Back to the room
          </button>
        </div>
      </header>

      <div
        ref={gridRef}
        className="camview-grid"
        style={{ gridTemplateColumns: `repeat(${grid.cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${grid.rows}, minmax(0, 1fr))` }}
      >
        {players.length === 0 && <p className="camview-empty">No phones yet. Scan the code in the room to join.</p>}
        {players.map((p) => (
          <Feed key={p.id} player={p} active={p.id === activeId} layout={grid.layout} dense={grid.dense} replay={replay} />
        ))}
      </div>

      <p className="camview-foot">
        The same on-device pipeline could watch a driver for drowsiness and distraction, with no video leaving the car.
      </p>
    </section>
  );
}

/** Columns and rows for the feeds, aiming for cells about half again as wide as tall. */
function gridFor(n: number, w: number, h: number) {
  let best = { cols: 1, rows: Math.max(1, n), score: Infinity };
  for (let cols = 1; cols <= Math.max(1, n); cols++) {
    const rows = Math.ceil(n / cols) || 1;
    const cw = (w - GAP * (cols - 1)) / cols;
    const ch = (h - GAP * (rows - 1)) / rows;
    const score = Math.abs(Math.log(cw / ch / 1.5)) + (cols * rows - n) * 0.15;
    if (score < best.score) best = { cols, rows, score };
  }
  const cw = (w - GAP * (best.cols - 1)) / best.cols;
  const ch = (h - GAP * (best.rows - 1)) / best.rows;
  return { cols: best.cols, rows: best.rows, layout: cw / ch >= 0.85 ? ('side' as const) : ('stack' as const), dense: ch < 380 };
}

// One phone's feed

interface FeedProps {
  player: PlayerInfo;
  active: boolean;
  /** side: camera beside the readouts; stack: camera above them. */
  layout: 'side' | 'stack';
  /** Short cells drop the method lines. */
  dense: boolean;
  replay: boolean;
}

function Feed({ player, active, layout, dense, replay }: FeedProps) {
  const p = useLivePlayer(player.id);
  const f = p.stale ? null : p.features;
  const v = f?.vision;
  const monitor = driverMonitor(f, useEyesShutFor(f), replay);

  return (
    <article className={`feed ${layout} ${dense ? 'dense' : ''} ${active ? 'active' : ''}`}>
      <header className="feed-head">
        <span className="feed-name">{player.name}</span>
        <span className="feed-perf">
          {f ? (
            <>
              <span>{f.fps.toFixed(0)} fps</span>
              {v && <span>{v.inferMs.toFixed(0)} ms</span>}
              {v && <span>{v.gpu ? 'GPU' : 'CPU'}</span>}
              {v && <span>{v.vad === 'silero' ? 'Silero VAD' : v.vad === 'rms' ? 'Level VAD' : 'VAD loading'}</span>}
            </>
          ) : (
            <span className="bad">No signal</span>
          )}
        </span>
      </header>

      <div className="feed-body">
        <div className="feed-view">
          <ViewCanvas id={player.id} />
          <span className="feed-tag">Landmarks only · no video</span>
        </div>

        <ul className="feed-signals">
          <Signal
            label="Blinks"
            method="Eye aspect ratio + blendshapes"
            value={f ? `${Math.round(f.face.blinkPm)}/min` : null}
            note={v ? (v.eyesClosed ? 'Eyes shut' : v.lastBlinkMs ? `last ${v.lastBlinkMs} ms` : 'Eyes open') : ''}
            hot={!!v?.eyesClosed}
            id={player.id}
            trace="eyes"
          />
          <Signal
            label="Lip press"
            method="Mouth press + roll blendshapes"
            value={f ? f.face.lipPress.toFixed(2) : null}
            id={player.id}
            trace="lip"
          />
          <Signal
            label="Head pose"
            method="6-DoF face transform"
            value={v ? `${signed(v.yaw)}° ${signed(v.pitch)}° ${signed(v.roll)}°` : f ? `${f.face.headMotion.toFixed(0)}°/s` : null}
            note={v ? `turn · nod · tilt, moving ${f!.face.headMotion.toFixed(0)}°/s` : ''}
            id={player.id}
            trace="motion"
          />
          <Signal
            label="Pulse"
            method="rPPG: POS on skin colour"
            value={f?.hr.bpm ? `${Math.round(f.hr.bpm)} bpm` : f ? 'Searching' : null}
            note={f ? `signal ${f.hr.quality.toFixed(2)}${f.face.headMotion > 20 ? ' · too much motion' : ''}` : ''}
            id={player.id}
            trace="pulse"
          />
          <li className="signal monitor">
            <span className="signal-label">
              {dense ? 'Driver' : 'Driver monitor'}
              <span className="signal-method">
                PERCLOS {v ? `${Math.round(v.perclos * 100)}%` : ''}
                {dense ? '' : ' over 30 s'}
              </span>
            </span>
            <span className={`monitor-state ${monitor.tone}`}>
              <span className="dot" />
              {monitor.text}
            </span>
          </li>
        </ul>
      </div>
    </article>
  );
}

/** How long the eyes have been reported shut without a break, in ms. */
function useEyesShutFor(f: FeaturesPacket | null | undefined): number {
  const since = useRef<number | null>(null);
  const shut = !!f?.vision?.eyesClosed && f.face.present;
  if (!shut) since.current = null;
  else since.current ??= performance.now();
  return since.current === null ? 0 : performance.now() - since.current;
}

/** The driver-monitoring read of the same signals: alert, distracted or drowsy. */
function driverMonitor(f: FeaturesPacket | null | undefined, shutMs: number, replay: boolean): { text: string; tone: '' | 'warn' | 'bad' } {
  const v = f?.vision;
  if (!f) return { text: 'No signal', tone: 'bad' };
  if (!f.face.present) return { text: 'No face', tone: 'warn' };
  if (!v) return replay ? { text: 'Live only', tone: 'warn' } : { text: 'Starting', tone: 'warn' };
  if (shutMs > 1000) return { text: 'Eyes shut', tone: 'bad' };
  if (v.perclos >= DROWSY_PERCLOS) return { text: 'Drowsy', tone: 'bad' };
  if (v.pitch < -25) return { text: 'Head down', tone: 'warn' };
  if (Math.abs(v.yaw) > 30 || f.face.gazeOff > 0.6) return { text: 'Eyes off road', tone: 'warn' };
  return { text: 'Alert', tone: '' };
}

function signed(v: number): string {
  const r = Math.round(v);
  return `${r < 0 ? '−' : r > 0 ? '+' : ''}${Math.abs(r)}`;
}

interface SignalProps {
  label: string;
  method: string;
  value: string | null;
  note?: string;
  hot?: boolean;
  id: string;
  trace: TraceKind;
}

function Signal({ label, method, value, note, hot, id, trace }: SignalProps) {
  return (
    <li className={`signal ${hot ? 'hot' : ''}`}>
      <span className="signal-label">
        {label}
        <span className="signal-method">{method}</span>
      </span>
      <span className={`signal-value ${value === null ? 'empty' : ''}`}>{value ?? '—'}</span>
      <Trace id={id} kind={trace} />
      {note && <span className="signal-note">{note}</span>}
    </li>
  );
}

// Drawing: one animation loop for every canvas on the screen.

type Drawer = (now: number, dt: number) => void;
const drawers = new Set<Drawer>();
let frame = 0;
let last = 0;

function tick(now: number) {
  const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60;
  last = now;
  for (const draw of drawers) {
    // One broken canvas mustn't stop the others.
    try {
      draw(now, dt);
    } catch (err) {
      console.error('camera view drawing failed', err);
    }
  }
  frame = drawers.size > 0 ? requestAnimationFrame(tick) : 0;
}

/** Draws on a canvas every frame, sized to its box at the screen's pixel ratio. */
function useCanvas(draw: (ctx: CanvasRenderingContext2D, w: number, h: number, now: number, dt: number) => void) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef(draw);
  drawRef.current = draw;
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    let w = 0;
    let h = 0;
    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    const drawer: Drawer = (now, dt) => {
      if (w > 0 && h > 0) drawRef.current(ctx, w, h, now, dt);
    };
    drawers.add(drawer);
    if (!frame) {
      last = 0;
      frame = requestAnimationFrame(tick);
    }
    return () => {
      observer.disconnect();
      drawers.delete(drawer);
    };
  }, []);
  return ref;
}

// The camera frame with the landmarks and detections

const FULL = 478;
/** Landmarks the overlays hang off. */
const NOSE_TIP = 1;
const IRIS_CENTRES = [468, 473] as const;

function ViewCanvas({ id }: { id: string }) {
  const shown = useRef<Shown>({
    full: new Float32Array(FULL * 3),
    fullPrimed: false,
    mesh: new Float32Array(MESH_POINTS.length * 3),
    meshPrimed: false,
    lens: { s: 0, cx: 0, cy: 0, primed: false },
  });
  const ref = useCanvas((ctx, w, h, now, dt) => drawView(ctx, w, h, now, dt, live.get(id), shown.current));
  return <canvas ref={ref} className="feed-canvas" />;
}

interface Shown {
  full: Float32Array;
  fullPrimed: boolean;
  mesh: Float32Array;
  meshPrimed: boolean;
  /** The virtual camera over the frame: scale (screen px per camera px) and the point it centres on. */
  lens: { s: number; cx: number; cy: number; primed: boolean };
}

/** Most a face gets zoomed, over fitting the whole frame. */
const MAX_ZOOM = 3;

function drawView(ctx: CanvasRenderingContext2D, w: number, h: number, now: number, dt: number, p: LivePlayer, shown: Shown) {
  const f = p.stale ? null : p.features;
  const v = f?.vision;
  ctx.clearRect(0, 0, w, h);

  const k = 1 - Math.exp(-dt * 14);
  const fullFresh = now - p.fullAt < 1000 && !!f?.face.present;
  const meshFresh = now - p.meshAt < 1000 && !!f?.face.present;
  if (fullFresh) {
    ease(shown.full, p.full, shown.fullPrimed ? k : 1);
    shown.fullPrimed = true;
  } else {
    shown.fullPrimed = false;
  }

  // The camera frame, fitted inside the box, then zoomed in on the face so the detections stay
  // readable. It never zooms past the frame's edges, so where the face sits stays true.
  const frameW = v && v.frameW > 0 ? v.frameW : 480;
  const frameH = v && v.frameH > 0 ? v.frameH : 640;
  const fit = Math.min(w / frameW, h / frameH);
  let target = { s: fit, cx: frameW / 2, cy: frameH / 2 };
  if (fullFresh) {
    const b = bounds(shown.full);
    const faceW = Math.max(1, (b.x1 - b.x0) * frameW);
    const faceH = Math.max(1, (b.y1 - b.y0) * frameH);
    const s = Math.min(fit * MAX_ZOOM, Math.max(fit, Math.min((h * 0.6) / faceH, (w * 0.72) / faceW)));
    target = { s, cx: ((b.x0 + b.x1) / 2) * frameW, cy: ((b.y0 + b.y1) / 2) * frameH };
  }
  const lens = shown.lens;
  const kl = lens.primed ? 1 - Math.exp(-dt * 2.5) : 1;
  lens.s += (target.s - lens.s) * kl;
  lens.cx += (target.cx - lens.cx) * kl;
  lens.cy += (target.cy - lens.cy) * kl;
  lens.primed = true;

  const sw = frameW * lens.s;
  const sh = frameH * lens.s;
  const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
  const ox = sw >= w ? clamp(w / 2 - lens.cx * lens.s, w - sw, 0) : (w - sw) / 2;
  const oy = sh >= h ? clamp(h / 2 - lens.cy * lens.s, h - sh, 0) : (h - sh) / 2;

  ctx.fillStyle = '#0a0c10';
  ctx.fillRect(ox, oy, sw, sh);
  ctx.strokeStyle = `rgba(${CREAM}, 0.06)`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i < 3; i++) {
    ctx.moveTo(ox + (sw * i) / 3, oy);
    ctx.lineTo(ox + (sw * i) / 3, oy + sh);
    ctx.moveTo(ox, oy + (sh * i) / 3);
    ctx.lineTo(ox + sw, oy + (sh * i) / 3);
  }
  ctx.stroke();
  // Viewfinder corners on the part of the frame in view, and the zoom.
  const vx = Math.max(0, ox);
  const vy = Math.max(0, oy);
  const vw = Math.min(w, ox + sw) - vx;
  const vh = Math.min(h, oy + sh) - vy;
  brackets(ctx, vx + 6, vy + 6, vw - 12, vh - 12, Math.min(22, vw * 0.08), `rgba(${CREAM}, 0.45)`, 1.5);
  const zoom = lens.s / fit;
  if (zoom > 1.15) {
    ctx.font = '600 11px "Instrument Sans", sans-serif';
    ctx.fillStyle = `rgba(${CREAM}, 0.6)`;
    ctx.textAlign = 'right';
    ctx.fillText(`${zoom.toFixed(1)}×`, vx + vw - 12, vy + 22);
    ctx.textAlign = 'start';
  }

  if (fullFresh) {
    drawFace(ctx, shown.full, ox, oy, sw, sh, now, p, f!);
    return;
  }

  if (meshFresh) {
    // The big screen's lighter mesh (a replay, or before the full frames arrive): centred.
    ease(shown.mesh, p.mesh, shown.meshPrimed ? k : 1);
    shown.meshPrimed = true;
    const s = Math.min(vh * 0.62, vw * 0.85);
    const cx = vx + vw / 2;
    const cy = vy + vh * 0.48;
    ctx.strokeStyle = `rgba(${CREAM}, 0.8)`;
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    for (let i = 0; i < MESH_EDGES.length; i += 2) {
      const a = MESH_EDGES[i]! * 3;
      const b = MESH_EDGES[i + 1]! * 3;
      ctx.moveTo(cx + shown.mesh[a]! * s, cy - shown.mesh[a + 1]! * s);
      ctx.lineTo(cx + shown.mesh[b]! * s, cy - shown.mesh[b + 1]! * s);
    }
    ctx.stroke();
    return;
  }
  shown.meshPrimed = false;

  ctx.fillStyle = `rgba(${CREAM}, 0.55)`;
  ctx.font = '500 13px "Instrument Sans", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(!f ? 'Waiting for the phone' : f.face.present ? 'Starting the tracker' : 'No face in view', vx + vw / 2, vy + vh / 2);
  ctx.textAlign = 'start';
}

/** The landmarks' extent, as fractions of the frame. */
function bounds(pts: Float32Array) {
  const b = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
  for (let i = 0; i < FULL; i++) {
    b.x0 = Math.min(b.x0, pts[i * 3]!);
    b.x1 = Math.max(b.x1, pts[i * 3]!);
    b.y0 = Math.min(b.y0, pts[i * 3 + 1]!);
    b.y1 = Math.max(b.y1, pts[i * 3 + 1]!);
  }
  return b;
}

function drawFace(
  ctx: CanvasRenderingContext2D,
  pts: Float32Array,
  ox: number,
  oy: number,
  fw: number,
  fh: number,
  now: number,
  p: LivePlayer,
  f: FeaturesPacket,
) {
  const v = f.vision;
  const X = (i: number) => ox + pts[i * 3]! * fw;
  const Y = (i: number) => oy + pts[i * 3 + 1]! * fh;
  const path = (edges: readonly number[]) => {
    ctx.beginPath();
    for (let i = 0; i < edges.length; i += 2) {
      ctx.moveTo(X(edges[i]!), Y(edges[i]!));
      ctx.lineTo(X(edges[i + 1]!), Y(edges[i + 1]!));
    }
  };
  const b = bounds(pts);
  const x0 = ox + b.x0 * fw;
  const x1 = ox + b.x1 * fw;
  const y0 = oy + b.y0 * fh;
  const y1 = oy + b.y1 * fh;
  const faceH = y1 - y0;

  // The full mesh, faint.
  ctx.lineWidth = 0.6;
  ctx.strokeStyle = `rgba(${CREAM}, 0.17)`;
  path(FACE_TESSELATION);
  ctx.stroke();

  // Skin patches for the pulse: green once the phone has a pulse lock, beating with it.
  const bpm = f.hr.bpm;
  const beat = bpm ? Math.exp(-((((now / 1000) * bpm) / 60) % 1) * 6) : 0;
  const locked = f.hr.quality >= PULSE_MIN_QUALITY && !!bpm;
  ctx.setLineDash([3, 3]);
  ctx.lineWidth = 1;
  ctx.strokeStyle = locked ? `rgba(${GREEN}, ${0.45 + 0.45 * beat})` : `rgba(${CREAM}, 0.3)`;
  for (const region of PULSE_REGIONS) {
    let rx0 = Infinity,
      rx1 = -Infinity,
      ry0 = Infinity,
      ry1 = -Infinity;
    for (const i of region) {
      rx0 = Math.min(rx0, X(i));
      rx1 = Math.max(rx1, X(i));
      ry0 = Math.min(ry0, Y(i));
      ry1 = Math.max(ry1, Y(i));
    }
    // Shrunk like the phone does, so the box is the skin it actually averages.
    const px = (rx1 - rx0) * 0.15;
    const py = (ry1 - ry0) * 0.15;
    ctx.strokeRect(rx0 + px, ry0 + py, rx1 - rx0 - 2 * px, ry1 - ry0 - 2 * py);
  }
  ctx.setLineDash([]);

  // Outline, brows and nose.
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = `rgba(${CREAM}, 0.6)`;
  path(FACE_PARTS.oval);
  ctx.stroke();
  path([...FACE_PARTS.leftBrow, ...FACE_PARTS.rightBrow]);
  ctx.stroke();

  // Eyes: coral while shut and for a moment after each blink.
  const lastBlink = p.blinks.at(-1) ?? -Infinity;
  const shut = !!v?.eyesClosed || now - lastBlink < 280;
  path([...FACE_PARTS.leftEye, ...FACE_PARTS.rightEye]);
  ctx.lineWidth = shut ? 2 : 1.3;
  ctx.strokeStyle = shut ? `rgba(${CORAL}, 1)` : `rgba(${CREAM}, 0.9)`;
  ctx.stroke();
  if (shut) {
    const ex = (X(IRIS_CENTRES[0]) + X(IRIS_CENTRES[1])) / 2;
    const ey = Math.min(Y(IRIS_CENTRES[0]), Y(IRIS_CENTRES[1])) - faceH * 0.14;
    label(ctx, 'Blink', ex, ey, CORAL);
  } else {
    // Irises, as circles through their four edge points.
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = `rgba(${CREAM}, 0.95)`;
    for (const [centre, ring] of [
      [IRIS_CENTRES[0], FACE_PARTS.rightIris],
      [IRIS_CENTRES[1], FACE_PARTS.leftIris],
    ] as const) {
      let r = 0;
      for (const i of ring) r += Math.hypot(X(i) - X(centre), Y(i) - Y(centre));
      r /= ring.length;
      ctx.beginPath();
      ctx.arc(X(centre), Y(centre), Math.max(1.5, r), 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = `rgba(${CREAM}, 0.95)`;
      ctx.fillRect(X(centre) - 1, Y(centre) - 1, 2, 2);
    }
  }

  // Lips: warmer and heavier the harder they're pressed.
  const press = Math.min(1, Math.max(0, (f.face.lipPress - 0.12) / 0.28));
  path(FACE_PARTS.lips);
  ctx.lineWidth = 1.2 + press * 1.4;
  ctx.strokeStyle = mix(press);
  ctx.stroke();

  // Head pose: a ray from the nose tip, the way the face points.
  if (v) {
    const len = faceH * 0.45;
    const nx = X(NOSE_TIP);
    const ny = Y(NOSE_TIP);
    const ex = nx + Math.sin((v.yaw * Math.PI) / 180) * len;
    const ey = ny - Math.sin((v.pitch * Math.PI) / 180) * len;
    ctx.strokeStyle = `rgba(${CREAM}, 0.95)`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(nx, ny);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(ex, ey, 3, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${CREAM}, 0.95)`;
    ctx.fill();
  }

  // The detection box.
  const pad = faceH * 0.06;
  brackets(ctx, x0 - pad, y0 - pad, x1 - x0 + 2 * pad, y1 - y0 + 2 * pad, Math.min(16, faceH * 0.1), `rgba(${CREAM}, 0.8)`, 1.5);
  ctx.font = '600 10px "Instrument Sans", sans-serif';
  ctx.fillStyle = `rgba(${CREAM}, 0.8)`;
  const tag = `FACE · ${FULL} POINTS`;
  ctx.fillText(tag, Math.max(ox + 8, x0 - pad), Math.max(oy + 14, y0 - pad - 6));
}

/** Cream at no press to coral at a firm one. */
function mix(k: number): string {
  const c = [243, 230, 196];
  const d = [240, 138, 120];
  return `rgba(${c.map((x, i) => Math.round(x + (d[i]! - x) * k)).join(', ')}, ${0.85 + 0.15 * k})`;
}

function ease(out: Float32Array, target: Float32Array, k: number) {
  for (let i = 0; i < out.length; i++) out[i]! += (target[i]! - out[i]!) * k;
}

/** Corner marks around a box, like a viewfinder. */
function brackets(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, len: number, color: string, width: number) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  for (const [cx, cy, dx, dy] of [
    [x, y, 1, 1],
    [x + w, y, -1, 1],
    [x, y + h, 1, -1],
    [x + w, y + h, -1, -1],
  ] as const) {
    ctx.moveTo(cx + dx * len, cy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx, cy + dy * len);
  }
  ctx.stroke();
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, rgb: string) {
  ctx.font = '600 11px "Instrument Sans", sans-serif';
  const w = ctx.measureText(text).width + 12;
  ctx.fillStyle = `rgba(${rgb}, 0.9)`;
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - 16, w, 18, 9);
  ctx.fill();
  ctx.fillStyle = '#0a0c10';
  ctx.textAlign = 'center';
  ctx.fillText(text, x, y - 3);
  ctx.textAlign = 'start';
}

// Signal traces over the last 12 seconds

type TraceKind = 'eyes' | 'lip' | 'motion' | 'pulse';

const TRACES: Record<TraceKind, { value: (h: HistoryPoint) => number | null; min: number; max: number; line?: number }> = {
  // Open eyes sit near 1; the dashed line is where the phone calls them shut.
  eyes: { value: (h) => h.eyes, min: 0.35, max: 1.25, line: EYES_SHUT },
  lip: { value: (h) => h.lip, min: 0, max: 0.5 },
  motion: { value: (h) => h.motion, min: 0, max: 40 },
  pulse: { value: (h) => h.quality, min: 0, max: 0.8, line: PULSE_MIN_QUALITY },
};

function Trace({ id, kind }: { id: string; kind: TraceKind }) {
  const ref = useCanvas((ctx, w, h, now) => drawTrace(ctx, w, h, now, live.get(id), kind));
  return <canvas ref={ref} className="signal-trace" />;
}

function drawTrace(ctx: CanvasRenderingContext2D, w: number, h: number, now: number, p: LivePlayer, kind: TraceKind) {
  const spec = TRACES[kind];
  const x = (t: number) => w - ((now - t) / HISTORY_MS) * w;
  const y = (v: number) => 2 + (h - 4) * (1 - Math.min(1, Math.max(0, (v - spec.min) / (spec.max - spec.min))));
  ctx.clearRect(0, 0, w, h);

  if (spec.line !== undefined) {
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = `rgba(${CORAL}, 0.5)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y(spec.line));
    ctx.lineTo(w, y(spec.line));
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (kind === 'eyes') {
    ctx.fillStyle = `rgba(${CORAL}, 0.9)`;
    for (const t of p.blinks) ctx.fillRect(Math.round(x(t)) - 1, 0, 2, h);
  }

  ctx.strokeStyle = `rgba(${CREAM}, 0.9)`;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  let pen = false;
  for (const point of p.history) {
    const v = spec.value(point);
    if (v === null) {
      pen = false;
      continue;
    }
    if (pen) ctx.lineTo(x(point.t), y(v));
    else ctx.moveTo(x(point.t), y(v));
    pen = true;
  }
  ctx.stroke();
}
