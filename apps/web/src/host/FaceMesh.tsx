import { MESH_EDGES, MESH_POINTS } from '@deadpan/shared';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { AdditiveBlending, BufferAttribute, BufferGeometry, DynamicDrawUsage, type LineBasicMaterial, type PointsMaterial } from 'three';
import { live } from './live';

const NEON = '#4de8ff';

/** A player's face as neon lines and points, eased between the 10 Hz mesh frames. */
export function FaceMesh({ id }: { id: string }) {
  const { positions, attribute, lines, points } = useMemo(() => {
    const positions = new Float32Array(MESH_POINTS.length * 3);
    const attribute = new BufferAttribute(positions, 3).setUsage(DynamicDrawUsage);
    const lines = new BufferGeometry().setAttribute('position', attribute).setIndex([...MESH_EDGES]);
    const points = new BufferGeometry().setAttribute('position', attribute);
    return { positions, attribute, lines, points };
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
  const shownAt = useRef(-Infinity);

  useFrame((_, dt) => {
    const p = live.get(id);
    if (p.meshAt > 0) {
      // Snap to the first frame, then ease towards each new one.
      const k = shownAt.current < 0 ? 1 : 1 - Math.exp(-dt * 14);
      for (let i = 0; i < positions.length; i++) positions[i]! += (p.mesh[i]! - positions[i]!) * k;
      attribute.needsUpdate = true;
      shownAt.current = p.meshAt;
    }
    const fresh = performance.now() - p.meshAt < 1000;
    const target = !fresh ? 0.12 : p.speaking || p.features?.voice.vad ? 1 : 0.7;
    for (const m of [lineMaterial.current, pointMaterial.current]) {
      if (m) m.opacity += (target - m.opacity) * (1 - Math.exp(-dt * 6));
    }
  });

  return (
    <group>
      <lineSegments geometry={lines} frustumCulled={false}>
        <lineBasicMaterial ref={lineMaterial} color={NEON} transparent opacity={0} blending={AdditiveBlending} depthWrite={false} />
      </lineSegments>
      <points geometry={points} frustumCulled={false}>
        <pointsMaterial
          ref={pointMaterial}
          color="#c4f8ff"
          size={3}
          sizeAttenuation={false}
          transparent
          opacity={0}
          blending={AdditiveBlending}
          depthWrite={false}
        />
      </points>
    </group>
  );
}
