import { Color } from 'three';

const CALM = new Color('#4de8ff');
const HOT = new Color('#ff3b5c');

/** Drift at which a suspect is fully "hot" red. */
const HOT_DRIFT = 1.5;

/** Calm blue to hot red, by how far a player has drifted from their baseline. */
export function driftColor(drift: number | null, out = new Color()): Color {
  const k = drift === null ? 0 : Math.min(1, Math.max(0, drift / HOT_DRIFT));
  return out.copy(CALM).lerp(HOT, k);
}

export function driftCss(drift: number | null): string {
  return `#${driftColor(drift).getHexString()}`;
}
