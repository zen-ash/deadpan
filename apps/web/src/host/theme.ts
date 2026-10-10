import { Color } from 'three';

/** Face lines are warm cream when calm and turn coral as a player drifts from their baseline. */
const CALM = new Color('#f3e6c4');
const HOT = new Color('#f08a78');

/** Drift at which a suspect is fully coral. */
const HOT_DRIFT = 1.5;

/** Cream to coral, by how far a player has drifted from their baseline. */
export function driftColor(drift: number | null, out = new Color()): Color {
  const k = drift === null ? 0 : Math.min(1, Math.max(0, drift / HOT_DRIFT));
  return out.copy(CALM).lerp(HOT, k);
}
