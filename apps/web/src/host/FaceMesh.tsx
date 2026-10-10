import { MESH_EDGES, MESH_POINTS } from '@deadpan/shared';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, DynamicDrawUsage, type LineBasicMaterial, type PointsMaterial } from 'three';
import { live } from './live';
import { driftColor } from './theme';

/** Colours above 1 so the bloom pass gives the lines a soft glow. */
const GLOW = 1.7;

interface Props {
  id: string;
  /** Latest drift from baseline: cream at 0, coral at 1.5 and above. */
  drift: number | null;
  /** Someone else is under the lamp. */
  dim?: boolean;
}

/**
 * A player's face as glowing lines and points, eased between the 10 Hz mesh frames. When the phone
 * reports a heart rate, a pulse ripples down the face on every beat.
 */
export function FaceMesh({ id, drift, dim = false }: Props) {
  const { target, positions, attribute, lines, points } = useMemo(() => {
    const target = new Float32Array(MESH_POINTS.length * 3);
    const positions = new Float32Array(MESH_POINTS.length * 3);
    const attribute = new BufferAttribute(positions, 3).setUsage(DynamicDrawUsage);
    const lines = new BufferGeometry().setAttribute('position', attribute).setIndex([...MESH_EDGES]);
    const points = new BufferGeometry().setAttribute('position', attribute);
    return { target, positions, attribute, lines, points };
  }, []);
  useEffect(
    () => () => {
      lines.dispose();
      points.dispose();
    },
    [lines, points],
  );

  const lineMaterial = useRef<LineBasicMaterial>(null);
  const pointMaterial = useRef<PointsMaterial>(null);
  const primed = useRef(false);
  const beat = useRef(0);
  const color = useMemo(() => new Color(), []);
  const shown = useMemo(() => new Color(), []);

  useFrame((_, dt) => {
    const p = live.get(id);
    if (p.meshAt > 0) {
      // Snap to the first frame, then ease towards each new one.
      const k = primed.current ? 1 - Math.exp(-dt * 14) : 1;
      primed.current = true;
      for (let i = 0; i < target.length; i++) target[i]! += (p.mesh[i]! - target[i]!) * k;
    }

    // Heartbeat: a sharp swell on each beat, travelling from forehead to chin.
    const bpm = p.features?.hr.bpm ?? null;
    beat.current = bpm ? beat.current + (dt * bpm) / 60 : 0;
    for (let i = 0; i < target.length; i += 3) {
      let scale = 1;
      if (bpm) {
        const phase = (((beat.current - (0.5 - target[i + 1]!) * 0.6) % 1) + 1) % 1;
        scale = 1 + 0.045 * Math.exp(-phase * 7);
      }
      positions[i] = target[i]! * scale;
      positions[i + 1] = target[i + 1]! * scale;
      positions[i + 2] = target[i + 2]! * scale;
    }
    attribute.needsUpdate = true;

    const fresh = performance.now() - p.meshAt < 1000;
    const speaking = p.speaking || !!p.features?.voice.vad;
    const opacity = !fresh ? 0.12 : dim ? 0.35 : speaking ? 1 : 0.8;
    driftColor(drift, color).multiplyScalar(GLOW);
    shown.lerp(color, 1 - Math.exp(-dt * 3));
    // Fine lines under brighter points, like the design's dotted outlines.
    const k = 1 - Math.exp(-dt * 6);
    const line = lineMaterial.current;
    const point = pointMaterial.current;
    if (line) {
      line.opacity += (opacity * 0.45 - line.opacity) * k;
      line.color.copy(shown);
    }
    if (point) {
      point.opacity += (opacity - point.opacity) * k;
      point.color.copy(shown);
    }
  });

  return (
    <group>
      <lineSegments geometry={lines} frustumCulled={false}>
        <lineBasicMaterial ref={lineMaterial} transparent opacity={0} blending={AdditiveBlending} depthWrite={false} toneMapped={false} />
      </lineSegments>
      <points geometry={points} frustumCulled={false}>
        <pointsMaterial
          ref={pointMaterial}
          size={3}
          sizeAttenuation={false}
          transparent
          opacity={0}
          blending={AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </points>
    </group>
  );
}
