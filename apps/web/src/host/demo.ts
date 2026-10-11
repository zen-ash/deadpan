// Demo mode (/host/ROOM?demo=N): plays back rounds/ROOM-N.json in place of the live socket, so
// the big screen looks and sounds just as it did. The game messages come from the recording's
// event log at their original times; signals and face meshes are replayed from its 10 Hz samples
// and 5 Hz meshes, eased to 15 Hz. Before the round and after it, the first and last few seconds
// loop back and forth so the faces stay alive.
import {
  MESH_HEADER,
  MESH_MAGIC,
  MESH_POINTS,
  type ClientToServer,
  type FeaturesPacket,
  type HostToServer,
  type RoundFile,
  type RoundSample,
  type ServerToClient,
} from '@deadpan/shared';
import type { Link, SocketHandlers } from '../lib/socket';

const TICK_MS = 1000 / 15;
/** The stretch of signals that loops in the lobby and after the end. */
const LOOP_MS = 6000;
/** Mesh frames further apart than this mean the face was out of view in between. */
const MESH_GAP_MS = 600;
/** Seconds to wait for a round that just ended to finish saving. */
const SAVE_WAIT_TRIES = 20;

interface Track {
  id: string;
  slot: number;
  samples: RoundSample[];
  meshes: { t: number; pts: Int16Array }[];
  speech: [number, 0 | 1][];
  /** Playback positions. */
  sample: number;
  speechAt: number;
}

export class DemoSocket implements Link {
  readonly clock = {
    now: () => this.fileTime(),
    toServer: (local: number) => local,
  };
  private file: RoundFile | null = null;
  private tracks: Track[] = [];
  private mode: 'loading' | 'lobby' | 'playing' | 'ended' = 'loading';
  private playStart = 0;
  private eventAt = 0;
  private readonly frame = new Int16Array(MESH_HEADER + MESH_POINTS.length * 3);
  private readonly timer: number;
  private stopped = false;

  constructor(
    private readonly room: string,
    private readonly round: number,
    private readonly handlers: SocketHandlers,
    /** Called once the recording is loaded, with every line's audio, so it can be fetched ahead. */
    private readonly onLines?: (urls: string[]) => void,
  ) {
    this.timer = window.setInterval(this.tick, TICK_MS);
    void this.load();
  }

  send(msg: ClientToServer | HostToServer) {
    if (!this.file) return;
    if (msg.t === 'start_round') this.play();
    else if (msg.t === 'end_round') this.toLobby();
    // Everything else (line ends, the camera view) only matters to a live round.
  }

  close() {
    this.stopped = true;
    clearInterval(this.timer);
  }

  private async load() {
    try {
      const file = await this.fetchSaved();
      if (!file.events?.length) throw new Error('That round was recorded before demo mode existed. Record a new one.');
      if (this.stopped) return;
      this.file = file;
      this.onLines?.(file.events!.flatMap(([, e]) => (e.t === 'say' ? [e.line.url] : [])));
      this.tracks = file.players.map((p) => ({
        id: p.id,
        slot: p.slot,
        samples: file.samples[p.id] ?? [],
        meshes: (file.meshes[p.id] ?? []).map(([t, b64]) => ({ t, pts: decodeMesh(b64) })),
        speech: file.speech[p.id] ?? [],
        sample: 0,
        speechAt: 0,
      }));
      this.handlers.onConnectedChange?.(true);
      this.emit({ t: 'welcome', room: this.room, playerId: null });
      this.emit({ t: 'room', room: this.room, players: file.players.map((p) => ({ ...p, cam: true, mic: true, online: true })) });
      this.toLobby();
    } catch (err) {
      if (this.stopped) return;
      const message = err instanceof Error ? err.message : String(err);
      this.handlers.onConnectedChange?.(true);
      this.emit({ t: 'error', code: 'bad_room', message: `Demo mode: ${message}` });
    }
  }

  /** The round's file. A round that just ended is still saved for a few seconds, so wait for it. */
  private async fetchSaved(): Promise<RoundFile> {
    for (let tries = 0; ; tries++) {
      const res = await fetch(`/api/rounds/${this.room}/${this.round}`, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok)
        throw new Error(res.status === 404 ? `No recording of room ${this.room}, round ${this.round}.` : `Server error ${res.status}.`);
      if (res.headers.get('X-Round-Saved') !== '0' || tries >= SAVE_WAIT_TRIES) return (await res.json()) as RoundFile;
      await new Promise((r) => setTimeout(r, 1000));
      if (this.stopped) throw new Error('stopped');
    }
  }

  private toLobby() {
    this.mode = 'lobby';
    this.emit({
      t: 'state',
      phase: 'lobby',
      mode: this.file?.mode ?? 'imposter',
      round: 0,
      roundPlayers: [],
      turn: null,
      dealEndsAt: null,
      verdictStage: null,
    });
  }

  private play() {
    // A lobby state first, so a replay after a replay starts clean.
    this.toLobby();
    this.mode = 'playing';
    this.playStart = performance.now();
    this.eventAt = 0;
    for (const track of this.tracks) {
      track.sample = 0;
      track.speechAt = 0;
    }
  }

  /** Where the recording is, in its own server time. */
  private fileTime(): number {
    const file = this.file;
    if (!file) return Date.now();
    if (this.mode === 'playing') return file.startedAt + (performance.now() - this.playStart);
    return this.mode === 'ended' ? file.endedAt : file.startedAt;
  }

  private readonly tick = () => {
    const file = this.file;
    if (!file || this.stopped) return;
    if (this.mode === 'playing') {
      const t = this.fileTime();
      const events = file.events!;
      while (this.eventAt < events.length && events[this.eventAt]![0] <= t) this.emit(events[this.eventAt++]![1]);
      for (const track of this.tracks) {
        while (track.speechAt < track.speech.length && track.speech[track.speechAt]![0] <= t) {
          const [at, on] = track.speech[track.speechAt++]!;
          this.emit({ t: 'speech', id: track.id, on: on === 1, ts: at });
        }
        let latest: RoundSample | undefined;
        while (track.sample < track.samples.length && track.samples[track.sample]![0] <= t) latest = track.samples[track.sample++];
        if (latest) this.emit({ t: 'pf', id: track.id, ...packet(latest) });
        this.sendMesh(track, t);
      }
      if (t >= file.endedAt && this.eventAt >= events.length) this.mode = 'ended';
      return;
    }
    // Lobby or after the end: loop a few seconds of signals back and forth.
    if (this.mode === 'loading') return;
    const from = this.mode === 'lobby' ? file.startedAt : Math.max(file.startedAt, file.endedAt - LOOP_MS);
    const phase = (performance.now() / LOOP_MS) % 2;
    const t = from + (phase < 1 ? phase : 2 - phase) * LOOP_MS;
    for (const track of this.tracks) {
      const s = nearest(track.samples, t);
      if (s) this.emit({ t: 'pf', id: track.id, ...packet(s) });
      this.sendMesh(track, t);
    }
  };

  /** The face at time t, between the two recorded frames around it. */
  private sendMesh(track: Track, t: number) {
    const m = track.meshes;
    if (m.length === 0) return;
    let i = 0;
    let hi = m.length - 1;
    // The last frame at or before t.
    while (i < hi) {
      const mid = (i + hi + 1) >> 1;
      if (m[mid]!.t <= t) i = mid;
      else hi = mid - 1;
    }
    const a = m[i]!;
    const b = m[i + 1];
    if (a.t > t && t - a.t < -MESH_GAP_MS) return;
    if (!b || b.t - a.t > MESH_GAP_MS) {
      // Hold the last frame briefly, then let the face fade as it did live.
      if (t - a.t > MESH_GAP_MS / 2) return;
      this.frame.set(a.pts);
    } else {
      const k = Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t)));
      for (let j = MESH_HEADER; j < this.frame.length; j++) this.frame[j] = Math.round(a.pts[j]! + (b.pts[j]! - a.pts[j]!) * k);
    }
    this.frame[0] = MESH_MAGIC;
    this.frame[1] = track.slot;
    this.handlers.onBinary?.(this.frame.buffer);
  }

  private emit(msg: ServerToClient) {
    if (!this.stopped) this.handlers.onMessage(msg);
  }
}

function decodeMesh(b64: string): Int16Array {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new Int16Array(bytes.buffer, 0, MESH_HEADER + MESH_POINTS.length * 3);
}

/** A recorded sample as the features packet the phone sent. */
function packet(s: RoundSample): FeaturesPacket {
  return {
    ts: s[0],
    fps: s[13] ?? 15,
    face: {
      present: s[10] === 1,
      blinkPm: s[12] ?? 0,
      blinkCount: s[3],
      lipPress: s[4],
      brow: s[5],
      gazeOff: s[6],
      headMotion: s[7],
      speaking: false,
    },
    voice: { pitchHz: s[1] > 0 ? s[1] : null, clarity: 0, vad: s[11] === 1, rms: s[2] },
    hr: { bpm: s[8] > 0 ? s[8] : null, quality: s[9] },
  };
}

function nearest(samples: RoundSample[], t: number): RoundSample | undefined {
  let lo = 0;
  let hi = samples.length - 1;
  if (hi < 0) return undefined;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (samples[mid]![0] < t) lo = mid + 1;
    else hi = mid;
  }
  return samples[lo];
}
