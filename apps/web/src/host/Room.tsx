// The big screen's noir interrogation room: a dark room with blinds on the wall, one swinging
// lamp, and a neon face per suspect. The lamp idles in the lobby, follows whoever is being
// questioned, sweeps across everyone during the drumroll, and lands on the accused.
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
  type Mesh,
  type PerspectiveCamera,
  type SpotLight as ThreeSpotLight,
  Vector3,
} from 'three';
import { anchors } from './anchors';
import { FaceMesh } from './FaceMesh';

const SPACING = 1.8;
const FACE_Y = 1.25;
/** Faces sit just above the middle of the screen: subtitles above, cards and evidence below. */
const LOOK_Y = 1.05;

export interface SuspectView {
  player: PlayerInfo;
  drift: number | null;
  lastAnswer?: AnswerResult;
  badge?: 'accused' | 'imposter' | 'both';
  benched?: boolean;
}

interface RoomProps {
  suspects: SuspectView[];
  /** Who the lamp points at; 'sweep' swings it across everyone; null lets it idle. */
  focus: string | 'sweep' | null;
  /** The player being questioned; everyone else dims. */
  activeId: string | null;
  /** Baseline phase: rings around each face. */
  calibrating: boolean;
}

export function Room(props: RoomProps) {
  return (
    <Canvas className="room-canvas" shadows dpr={[1, 2]} gl={{ antialias: false }} camera={{ position: [0, 1.5, 7], fov: 34 }}>
      <color attach="background" args={['#040507']} />
      <fog attach="fog" args={['#040507', 8, 20]} />
      <Scene {...props} />
      <EffectComposer multisampling={4}>
        <Bloom mipmapBlur intensity={1.3} luminanceThreshold={0.25} luminanceSmoothing={0.3} />
        <Noise premultiply blendFunction={BlendFunction.SCREEN} opacity={0.35} />
        <Vignette offset={0.2} darkness={0.9} />
      </EffectComposer>
    </Canvas>
  );
}

function Scene({ suspects, focus, activeId, calibrating }: RoomProps) {
  const n = Math.max(1, suspects.length);
  const xs = suspects.map((_, i) => (i - (suspects.length - 1) / 2) * SPACING);
  const index = typeof focus === 'string' && focus !== 'sweep' ? suspects.findIndex((s) => s.player.id === focus) : -1;
  const focusX = index >= 0 ? xs[index]! : null;
  return (
    <>
      <CameraRig players={n} />
      <ambientLight intensity={0.05} />
      <hemisphereLight args={['#2a3550', '#050608', 0.25]} />
      <Walls />
      <Table width={n * SPACING + 1.6} />
      <Blinds />
      <Lamp focusX={focusX} sweep={focus === 'sweep'} span={((suspects.length - 1) * SPACING) / 2} />
      {suspects.map((s, i) => (
        <Suspect
          key={s.player.id}
          view={s}
          x={xs[i]!}
          active={activeId === s.player.id}
          dim={activeId !== null && activeId !== s.player.id}
          calibrating={calibrating}
        />
      ))}
    </>
  );
}

/** Pulls the camera back as more suspects join, so everyone fits. */
function CameraRig({ players }: { players: number }) {
  const { camera, size } = useThree();
  useFrame((_, dt) => {
    const cam = camera as PerspectiveCamera;
    const halfWidth = (players * SPACING + 1.4) / 2;
    const tanH = Math.tan(((cam.fov / 2) * Math.PI) / 180) * (size.width / size.height);
    const z = Math.max(5.8, halfWidth / tanH + 1.2);
    cam.position.z += (z - cam.position.z) * (1 - Math.exp(-dt * 2));
    cam.position.y = 1.45;
    cam.lookAt(0, LOOK_Y, 0);
  });
  return null;
}

function Walls() {
  return (
    <>
      <mesh position={[0, 3, -3.2]} receiveShadow>
        <planeGeometry args={[40, 12]} />
        <meshStandardMaterial color="#171a21" roughness={1} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.7, 0]} receiveShadow>
        <planeGeometry args={[40, 40]} />
        <meshStandardMaterial color="#0a0b0e" roughness={0.95} />
      </mesh>
    </>
  );
}

function Table({ width }: { width: number }) {
  const ref = useRef<Mesh>(null);
  useFrame((_, dt) => {
    if (ref.current) ref.current.scale.x += (width - ref.current.scale.x) * (1 - Math.exp(-dt * 3));
  });
  return (
    <mesh ref={ref} position={[0, 0.05, 0.9]} receiveShadow>
      <boxGeometry args={[1, 0.08, 1.3]} />
      <meshStandardMaterial color="#2a1d14" roughness={0.6} metalness={0.1} />
    </mesh>
  );
}

/** Cool light through window blinds, striping the back wall. */
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
    l.target.position.set(-2, 2.6, -3.2);
    l.target.updateMatrixWorld();
  }, []);
  useEffect(() => () => stripes.dispose(), [stripes]);
  return (
    <spotLight
      ref={light}
      position={[6, 4.5, 3]}
      angle={0.5}
      penumbra={0.3}
      intensity={90}
      distance={25}
      decay={1.6}
      color="#7fa6ff"
      map={stripes}
      castShadow
      shadow-mapSize={[512, 512]}
    />
  );
}

interface LampProps {
  focusX: number | null;
  sweep: boolean;
  span: number;
}

/** A hanging lamp that swings gently and points its beam at whoever is in focus. */
function Lamp({ focusX, sweep, span }: LampProps) {
  const anchor = useRef<Group>(null);
  const light = useRef<ThreeSpotLight>(null);
  const x = useRef(0);
  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime;
    const target = sweep ? span * Math.sin(t * 2.6) : (focusX ?? 0);
    x.current += (target - x.current) * (1 - Math.exp(-dt * (sweep ? 12 : 2.5)));
    const swing = (focusX === null && !sweep ? 0.14 : 0.04) * Math.sin(t * 1.25);
    if (anchor.current) {
      anchor.current.position.x = x.current;
      anchor.current.rotation.z = swing;
    }
    const l = light.current;
    if (l) {
      l.target.position.set(x.current - Math.sin(swing) * 3, FACE_Y - 0.1, 0.1);
      l.target.updateMatrixWorld();
    }
  });
  return (
    <group ref={anchor} position={[0, 3.7, 0.5]}>
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
        distance={5}
        attenuation={4}
        anglePower={6}
        intensity={40}
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
  x: number;
  active: boolean;
  dim: boolean;
  calibrating: boolean;
}

function Suspect({ view, x, active, dim, calibrating }: SuspectProps) {
  const group = useRef<Group>(null);
  const born = useRef(performance.now());
  const point = useMemo(() => new Vector3(), []);
  const id = view.player.id;
  useEffect(() => () => void anchors.delete(id), [id]);
  useFrame(({ camera, size }, dt) => {
    const g = group.current;
    if (!g) return;
    // Where the card goes: just under the chin, in screen pixels.
    point.set(0, -0.6, 0);
    g.localToWorld(point);
    const distance = point.distanceTo(camera.position);
    point.project(camera);
    anchors.set(id, {
      x: ((point.x + 1) / 2) * size.width,
      y: ((1 - point.y) / 2) * size.height,
      scale: Math.min(1.1, Math.max(0.5, 6.8 / distance)),
    });
    // Pop in on arrival, then glide to a new seat when someone joins or leaves.
    const t = Math.min(1, (performance.now() - born.current) / 450);
    const pop = 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2;
    g.scale.setScalar(Math.max(0.001, pop));
    g.position.x += (x - g.position.x) * (1 - Math.exp(-dt * 4));
  });
  return (
    <group ref={group} position={[x, FACE_Y, 0]}>
      <FaceMesh id={view.player.id} drift={view.drift} dim={dim} />
      {calibrating && <CalibrationRing active={active} />}
    </group>
  );
}

/** "Calibrating…": broken rings circling each face while baselines are recorded. */
function CalibrationRing({ active }: { active: boolean }) {
  const group = useRef<Group>(null);
  const material = useMemo(
    () => new MeshBasicMaterial({ color: active ? new Color(2.4, 1.6, 0.4) : new Color(0.5, 1.6, 2), transparent: true, toneMapped: false }),
    [active],
  );
  useEffect(() => () => material.dispose(), [material]);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (group.current) group.current.rotation.z = t * (active ? 1.6 : 0.6);
    material.opacity = (active ? 0.75 : 0.25) + 0.15 * Math.sin(t * 4);
  });
  return (
    <group ref={group}>
      {[0, 1, 2].map((i) => (
        <mesh key={i} rotation-z={(i * Math.PI * 2) / 3} material={material}>
          <ringGeometry args={[0.66, 0.69, 48, 1, 0, Math.PI / 2]} />
        </mesh>
      ))}
    </group>
  );
}
