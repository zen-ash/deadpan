// The big screen's noir interrogation room: a dark room with golden light through blinds on the
// wall, one swinging lamp, and a glowing face per suspect. Faces are placed from screen-space slots (layout.ts), so
// they always fit the free area next to the overlay. The lamp idles in the lobby, follows whoever
// is questioned, sweeps across everyone during the drumroll, and lands on the accused.
import type { AnswerResult, PlayerInfo } from '@deadpan/shared';
import { SpotLight } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Bloom, EffectComposer, Noise, Vignette } from '@react-three/postprocessing';
import { BlendFunction } from 'postprocessing';
import { useEffect, useMemo, useRef } from 'react';
import {
  CanvasTexture,
  Color,
  DoubleSide,
  MeshBasicMaterial,
  type Group,
  type PerspectiveCamera,
  type SpotLight as ThreeSpotLight,
} from 'three';
import { FaceMesh } from './FaceMesh';
import type { Slot } from './layout';
import type { LieNote } from './SuspectCard';

const CAM_Y = 1.2;
const CAM_Z = 7;
const FOV = 34;

export interface SuspectView {
  player: PlayerInfo;
  /** Colours the face; the card shows it too (the round's mean once revealed). */
  drift: number | null;
  lastAnswer?: AnswerResult;
  benched?: boolean;
  /** After the reveal. */
  role?: 'imposter' | 'innocent';
  /** Two Truths and a Lie, once the verdict is out: the detective's pick, and the real lie after the reveal. */
  lie?: LieNote;
  /** The stamp on the card's corner after the reveal. */
  stamp?: 'caught' | 'accused' | 'escaped';
}

interface RoomProps {
  suspects: SuspectView[];
  /** One slot per suspect, in the same order. */
  slots: Slot[];
  /** Who the lamp points at; 'sweep' swings it across everyone; null lets it idle. */
  focus: string | 'sweep' | null;
  /** The player being questioned; everyone else dims. */
  activeId: string | null;
  /** Baseline phase: rings around each face. */
  calibrating: boolean;
  /** Stop drawing while something covers the whole room (the camera view). */
  paused?: boolean;
}

/** World placement for a screen slot: position at depth 0 and the face's height in world units. */
interface Placement {
  x: number;
  y: number;
  scale: number;
}

function usePlacements(slots: Slot[]): Placement[] {
  const { size } = useThree();
  // World units per CSS pixel at depth 0, for a camera looking straight down -z.
  const k = (2 * CAM_Z * Math.tan((FOV * Math.PI) / 360)) / Math.max(1, size.height);
  return slots.map((s) => ({
    x: (s.faceX - size.width / 2) * k,
    y: CAM_Y - (s.faceY - size.height / 2) * k,
    scale: s.faceH * k,
  }));
}

export function Room(props: RoomProps) {
  return (
    <Canvas
      className="room-canvas"
      frameloop={props.paused ? 'never' : 'always'}
      shadows
      dpr={[1, 2]}
      gl={{ antialias: false }}
      camera={{ position: [0, CAM_Y, CAM_Z], fov: FOV }}
    >
      <color attach="background" args={['#07080b']} />
      <fog attach="fog" args={['#07080b', 9, 20]} />
      <Scene {...props} />
      <EffectComposer multisampling={4}>
        <Bloom mipmapBlur intensity={1.3} luminanceThreshold={0.25} luminanceSmoothing={0.3} />
        <Noise premultiply blendFunction={BlendFunction.SCREEN} opacity={0.35} />
        <Vignette offset={0.2} darkness={0.9} />
      </EffectComposer>
    </Canvas>
  );
}

function Scene({ suspects, slots, focus, activeId, calibrating }: RoomProps) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  useEffect(() => {
    camera.position.set(0, CAM_Y, CAM_Z);
    camera.lookAt(0, CAM_Y, 0);
  }, [camera]);

  const placements = usePlacements(slots);
  const index = typeof focus === 'string' && focus !== 'sweep' ? suspects.findIndex((s) => s.player.id === focus) : -1;
  const xs = placements.map((p) => p.x);
  return (
    <>
      <ambientLight intensity={0.05} />
      <hemisphereLight args={['#2a2f3c', '#050608', 0.25]} />
      <Walls />
      <Blinds />
      <Lamp
        target={index >= 0 ? (placements[index] ?? null) : null}
        sweep={focus === 'sweep' && xs.length > 0 ? { from: Math.min(...xs), to: Math.max(...xs), y: placements[0]!.y } : null}
      />
      {suspects.map((s, i) =>
        placements[i] ? (
          <Suspect
            key={s.player.id}
            view={s}
            place={placements[i]!}
            active={activeId === s.player.id}
            dim={activeId !== null && activeId !== s.player.id}
            calibrating={calibrating}
          />
        ) : null,
      )}
    </>
  );
}

function Walls() {
  return (
    <>
      <mesh position={[0, 3, -3.2]} receiveShadow>
        <planeGeometry args={[60, 20]} />
        <meshStandardMaterial color="#14171e" roughness={1} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, -2.2, 0]} receiveShadow>
        <planeGeometry args={[60, 60]} />
        <meshStandardMaterial color="#0a0b0e" roughness={0.95} />
      </mesh>
    </>
  );
}

/** Warm light through window blinds, striping the back wall. */
function Blinds() {
  const light = useRef<ThreeSpotLight>(null);
  const stripes = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 256;
    const g = canvas.getContext('2d')!;
    g.fillStyle = '#000';
    g.fillRect(0, 0, 64, 256);
    g.fillStyle = '#fff';
    for (let y = 0; y < 256; y += 24) g.fillRect(0, y, 64, 14);
    return new CanvasTexture(canvas);
  }, []);
  useEffect(() => {
    const l = light.current;
    if (!l) return;
    l.target.position.set(-2, 2.4, -3.2);
    l.target.updateMatrixWorld();
  }, []);
  useEffect(() => () => stripes.dispose(), [stripes]);
  return (
    <spotLight
      ref={light}
      position={[6, 4.5, 3]}
      angle={0.55}
      penumbra={0.3}
      intensity={80}
      distance={25}
      decay={1.6}
      color="#ffd29a"
      map={stripes}
      castShadow
      shadow-mapSize={[512, 512]}
    />
  );
}

interface LampProps {
  target: Placement | null;
  sweep: { from: number; to: number; y: number } | null;
}

/** A hanging lamp that swings gently and points its beam at whoever is in focus. */
function Lamp({ target, sweep }: LampProps) {
  const anchor = useRef<Group>(null);
  const light = useRef<ThreeSpotLight>(null);
  const aim = useRef({ x: 0, y: CAM_Y });
  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime;
    let x = target?.x ?? 0;
    let y = target?.y ?? CAM_Y;
    if (sweep) {
      x = (sweep.from + sweep.to) / 2 + ((sweep.to - sweep.from) / 2 + 0.3) * Math.sin(t * 2.6);
      y = sweep.y;
    }
    const k = 1 - Math.exp(-dt * (sweep ? 12 : 2.5));
    aim.current.x += (x - aim.current.x) * k;
    aim.current.y += (y - aim.current.y) * k;
    const swing = (target || sweep ? 0.04 : 0.14) * Math.sin(t * 1.25);
    if (anchor.current) {
      anchor.current.position.x = aim.current.x;
      anchor.current.rotation.z = swing;
    }
    const l = light.current;
    if (l) {
      l.target.position.set(aim.current.x - Math.sin(swing) * 3, aim.current.y - 0.1, 0.1);
      l.target.updateMatrixWorld();
    }
  });
  return (
    <group ref={anchor} position={[0, 4.3, 0.5]}>
      <mesh position={[0, 1.2, 0]}>
        <cylinderGeometry args={[0.012, 0.012, 2.4]} />
        <meshStandardMaterial color="#0d0d0f" />
      </mesh>
      <mesh>
        <coneGeometry args={[0.34, 0.3, 32, 1, true]} />
        <meshStandardMaterial color="#20232a" metalness={0.7} roughness={0.35} side={DoubleSide} />
      </mesh>
      <mesh position={[0, -0.1, 0]}>
        <sphereGeometry args={[0.075, 16, 16]} />
        <meshBasicMaterial color={[5, 4, 2.6]} toneMapped={false} />
      </mesh>
      <SpotLight
        ref={light}
        position={[0, -0.12, 0]}
        angle={0.3}
        penumbra={0.6}
        distance={6}
        attenuation={4.5}
        anglePower={6}
        intensity={45}
        decay={1.4}
        color="#ffd6a0"
        opacity={0.12}
        volumetric
      />
    </group>
  );
}

interface SuspectProps {
  view: SuspectView;
  place: Placement;
  active: boolean;
  dim: boolean;
  calibrating: boolean;
}

function Suspect({ view, place, active, dim, calibrating }: SuspectProps) {
  const group = useRef<Group>(null);
  const born = useRef(performance.now());
  const size = useRef(place.scale);
  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;
    // Glide to a new seat when the layout changes; pop in on arrival.
    const k = 1 - Math.exp(-dt * 4);
    g.position.x += (place.x - g.position.x) * k;
    g.position.y += (place.y - g.position.y) * k;
    size.current += (place.scale - size.current) * k;
    // Grow in on arrival, easing out without overshoot.
    const t = Math.min(1, (performance.now() - born.current) / 450);
    const grow = 0.6 + 0.4 * (1 - (1 - t) ** 3);
    g.scale.setScalar(Math.max(0.001, grow * size.current));
  });
  return (
    <group ref={group} position={[place.x, place.y, 0]}>
      <FaceMesh id={view.player.id} drift={view.drift} dim={dim} />
      {/* The one answering gets the gold ring on the page instead. */}
      {calibrating && !active && <CalibrationRing />}
    </group>
  );
}

/** "Calibrating…": faint broken rings circling the faces waiting to set their baselines. */
function CalibrationRing() {
  const group = useRef<Group>(null);
  const material = useMemo(() => new MeshBasicMaterial({ color: new Color('#f3e6c4').multiplyScalar(0.9), transparent: true, toneMapped: false }), []);
  useEffect(() => () => material.dispose(), [material]);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (group.current) group.current.rotation.z = t * 0.5;
    material.opacity = 0.22 + 0.08 * Math.sin(t * 2);
  });
  return (
    <group ref={group}>
      {[0, 1, 2].map((i) => (
        <mesh key={i} rotation-z={(i * Math.PI * 2) / 3} material={material}>
          <ringGeometry args={[0.57, 0.585, 64, 1, 0, Math.PI / 2]} />
        </mesh>
      ))}
    </group>
  );
}
