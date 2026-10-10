// Live per-player data on the big screen: features (10 Hz JSON), speech events, and mesh
// frames (10 Hz binary). Kept outside React so the 3D meshes can read it every frame; cards
// subscribe through useLivePlayer and re-render when it changes.
import {
  MESH_HEADER,
  MESH_MAGIC,
  MESH_POINTS,
  MESH_QUANT,
  type FeaturesPacket,
  type PlayerInfo,
  type ServerToClient,
} from '@deadpan/shared';
import { useSyncExternalStore } from 'react';

/** No features for this long and a player's card shows "no signal". */
const STALE_MS = 2000;
/** Pitch only exists in voiced 100 ms windows; hold it this long so the bar doesn't flicker. */
const PITCH_HOLD_MS = 600;
/** A face lost within this long ago shows as "Face lost at times" on the card. */
const FACE_LOST_MEMORY_MS = 30_000;

export interface LivePlayer {
  features: FeaturesPacket | null;
  featuresAt: number;
  stale: boolean;
  speaking: boolean;
  /** Latest pitch, held briefly across unvoiced windows. */
  pitchHz: number | null;
  pitchAt: number;
  /** When the phone last reported no face in view. */
  faceLostAt: number;
  /** Target mesh positions in three.js space (y up, z towards the viewer). */
  mesh: Float32Array;
  meshAt: number;
  version: number;
}

class LiveStore {
  private readonly players = new Map<string, LivePlayer>();
  private readonly slots = new Map<number, string>();
  private readonly listeners = new Map<string, Set<() => void>>();

  constructor() {
    setInterval(() => {
      const now = performance.now();
      for (const [id, p] of this.players) {
        const stale = now - p.featuresAt > STALE_MS;
        if (stale !== p.stale) {
          p.stale = stale;
          this.changed(id, p);
        }
      }
    }, 500);
  }

  get(id: string): LivePlayer {
    let p = this.players.get(id);
    if (!p) {
      p = {
        features: null,
        featuresAt: -Infinity,
        stale: true,
        speaking: false,
        pitchHz: null,
        pitchAt: -Infinity,
        faceLostAt: -Infinity,
        mesh: new Float32Array(MESH_POINTS.length * 3),
        meshAt: -Infinity,
        version: 0,
      };
      this.players.set(id, p);
    }
    return p;
  }

  setRoster(players: PlayerInfo[]) {
    this.slots.clear();
    for (const p of players) this.slots.set(p.slot, p.id);
    const ids = new Set(players.map((p) => p.id));
    for (const id of this.players.keys()) if (!ids.has(id)) this.players.delete(id);
  }

  handle(msg: ServerToClient) {
    if (msg.t === 'pf') {
      const { t: _t, id, ...features } = msg;
      const p = this.get(id);
      p.features = features;
      p.featuresAt = performance.now();
      if (!features.face.present) p.faceLostAt = p.featuresAt;
      if (features.voice.pitchHz !== null) {
        p.pitchHz = features.voice.pitchHz;
        p.pitchAt = p.featuresAt;
      } else if (p.featuresAt - p.pitchAt > PITCH_HOLD_MS) {
        p.pitchHz = null;
      }
      p.stale = false;
      this.changed(id, p);
    } else if (msg.t === 'speech') {
      const p = this.get(msg.id);
      p.speaking = msg.on;
      this.changed(msg.id, p);
    }
  }

  handleMesh(data: ArrayBuffer) {
    const frame = new Int16Array(data);
    if (frame.length !== MESH_HEADER + MESH_POINTS.length * 3 || frame[0] !== MESH_MAGIC) return;
    const id = this.slots.get(frame[1]!);
    if (!id) return;
    const p = this.get(id);
    for (let i = 0; i < MESH_POINTS.length; i++) {
      const o = MESH_HEADER + i * 3;
      p.mesh[i * 3] = frame[o]! / MESH_QUANT;
      // Image y points down and MediaPipe's z points into the screen; three.js is the opposite.
      p.mesh[i * 3 + 1] = -frame[o + 1]! / MESH_QUANT;
      p.mesh[i * 3 + 2] = -frame[o + 2]! / MESH_QUANT;
    }
    p.meshAt = performance.now();
  }

  subscribe(id: string, fn: () => void): () => void {
    let set = this.listeners.get(id);
    if (!set) this.listeners.set(id, (set = new Set()));
    set.add(fn);
    return () => set.delete(fn);
  }

  private changed(id: string, p: LivePlayer) {
    p.version++;
    for (const fn of this.listeners.get(id) ?? []) fn();
  }
}

export const live = new LiveStore();

/** The face is in view now but went missing within the last half minute. */
export function faceLostRecently(p: LivePlayer): boolean {
  return !!p.features?.face.present && performance.now() - p.faceLostAt < FACE_LOST_MEMORY_MS;
}

/** Re-renders whenever this player's live data changes (about 10 times a second). */
export function useLivePlayer(id: string): LivePlayer {
  useSyncExternalStore(
    (fn) => live.subscribe(id, fn),
    () => live.get(id).version,
  );
  return live.get(id);
}
