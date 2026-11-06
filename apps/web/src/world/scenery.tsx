import { useFrame, useThree } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { studTexture } from './lego';

/* Island, water, mountains and clouds around the city: gives the city a real silhouette instead of a square slab. */

export const ISLAND_MARGIN = 30;
const CORNER = 36;

function roundedRect(half: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const c = Math.min(r, half);
  s.moveTo(-half + c, -half);
  s.lineTo(half - c, -half);
  s.quadraticCurveTo(half, -half, half, -half + c);
  s.lineTo(half, half - c);
  s.quadraticCurveTo(half, half, half - c, half);
  s.lineTo(-half + c, half);
  s.quadraticCurveTo(-half, half, -half, half - c);
  s.lineTo(-half, -half + c);
  s.quadraticCurveTo(-half, -half, -half + c, -half);
  return s;
}

/** Solid slab whose top face sits at `top` and which is `depth` thick. */
function slab(half: number, r: number, top: number, depth: number): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(roundedRect(half, r), { depth, bevelEnabled: false, curveSegments: 10 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, top - depth, 0);
  return g;
}

export function Island({ extent, night }: { extent: number; night: boolean }) {
  const half = extent / 2 + ISLAND_MARGIN;
  const geo = useMemo(() => {
    const lawn = new THREE.ShapeGeometry(roundedRect(half, CORNER), 10);
    lawn.rotateX(-Math.PI / 2);
    return {
      lawn,
      rock: slab(half + 1.5, CORNER + 1.5, -0.02, 8),
      sand: slab(half + 11, CORNER + 11, -0.7, 5),
      shelf: slab(half + 26, CORNER + 26, -1.9, 3),
    };
  }, [half]);
  // the stud texture's UVs follow world units on a ShapeGeometry, so 1/8 repeat = one 8 m tile
  const tex = useMemo(() => studTexture(1 / 8, 1 / 8), []);
  return (
    <group>
      <mesh geometry={geo.lawn} receiveShadow>
        <meshStandardMaterial color={night ? '#245a34' : '#4aa853'} map={tex} roughness={0.55} />
      </mesh>
      <mesh geometry={geo.rock} receiveShadow castShadow>
        <meshStandardMaterial color={night ? '#4d4a50' : '#8d7f6c'} roughness={0.95} flatShading />
      </mesh>
      <mesh geometry={geo.sand} receiveShadow>
        <meshStandardMaterial color={night ? '#8d8470' : '#ecd9a6'} roughness={1} />
      </mesh>
      <mesh geometry={geo.shelf}>
        <meshStandardMaterial color={night ? '#1d5a78' : '#4bb7d6'} roughness={0.6} transparent opacity={0.85} />
      </mesh>
    </group>
  );
}

export function Water({ night }: { night: boolean }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    // gentle bobbing of the whole sheet; cheap and avoids a custom shader
    if (ref.current) ref.current.position.y = -2.3 + Math.sin(clock.elapsedTime * 0.6) * 0.06;
  });
  return (
    <mesh ref={ref} rotation-x={-Math.PI / 2} position={[0, -2.3, 0]} receiveShadow>
      <circleGeometry args={[2200, 48]} />
      <meshStandardMaterial color={night ? '#0e2a52' : '#2a86d6'} roughness={0.12} metalness={0.15} envMapIntensity={1.4} />
    </mesh>
  );
}

const rnd = (k: number) => {
  const x = Math.sin(k * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** Ring of low-poly mountains on the horizon. They sit inside the fog range so they read as hazy silhouettes. */
export function Mountains({ extent, night }: { extent: number; night: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const snow = useRef<THREE.InstancedMesh>(null);
  const COUNT = 46;
  const base = extent / 2 + 330;
  useLayoutEffect(() => {
    const m = ref.current;
    const s = snow.current;
    if (!m || !s) return;
    const o = new THREE.Object3D();
    for (let i = 0; i < COUNT; i++) {
      const a = (i / COUNT) * Math.PI * 2 + rnd(i) * 0.1;
      const dist = base + rnd(i + 11) * 220;
      const h = 70 + rnd(i + 33) * 150;
      const w = 90 + rnd(i + 55) * 110;
      o.position.set(Math.cos(a) * dist, -2 + h / 2, Math.sin(a) * dist);
      o.rotation.set(0, rnd(i + 77) * Math.PI, 0);
      o.scale.set(w, h, w);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      // snow cap: same cone, shrunk to the top 28% of the mountain
      const cap = 0.28;
      o.position.set(Math.cos(a) * dist, -2 + h * (1 - cap / 2) + 0.4, Math.sin(a) * dist);
      o.scale.set(w * cap * 1.02, h * cap, w * cap * 1.02);
      o.updateMatrix();
      s.setMatrixAt(i, o.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
    s.instanceMatrix.needsUpdate = true;
  }, [base]);
  return (
    <>
      <instancedMesh ref={ref} args={[undefined, undefined, COUNT]} frustumCulled={false}>
        <coneGeometry args={[0.5, 1, 6, 1]} />
        <meshStandardMaterial color={night ? '#26304d' : '#5f7fa6'} roughness={1} flatShading fog />
      </instancedMesh>
      <instancedMesh ref={snow} args={[undefined, undefined, COUNT]} frustumCulled={false}>
        <coneGeometry args={[0.5, 1, 6, 1]} />
        <meshStandardMaterial color={night ? '#8b97c0' : '#f4f8ff'} roughness={1} flatShading fog />
      </instancedMesh>
    </>
  );
}

/** Soft drifting clouds built from instanced spheres (no texture download needed). */
export function Clouds({ extent }: { extent: number }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const puffs = useMemo(() => {
    const out: { x: number; y: number; z: number; s: number; speed: number }[] = [];
    const R = extent / 2 + 500;
    for (let c = 0; c < 16; c++) {
      const cx = (rnd(c + 1) - 0.5) * 2 * R;
      const cz = (rnd(c + 40) - 0.5) * 2 * R;
      const cy = 150 + rnd(c + 80) * 90;
      const speed = 1.5 + rnd(c + 120) * 2;
      for (let k = 0; k < 5; k++)
        out.push({
          x: cx + (k - 2) * 22 + (rnd(c * 7 + k) - 0.5) * 12,
          y: cy + (rnd(c * 13 + k) - 0.5) * 8,
          z: cz + (rnd(c * 5 + k) - 0.5) * 18,
          s: 22 + rnd(c * 3 + k) * 22,
          speed,
        });
    }
    return { out, R };
  }, [extent]);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  useFrame(({ clock }) => {
    const m = ref.current;
    if (!m) return;
    const t = clock.elapsedTime;
    const span = puffs.R * 2;
    puffs.out.forEach((p, i) => {
      const x = ((((p.x + t * p.speed + puffs.R) % span) + span) % span) - puffs.R;
      dummy.position.set(x, p.y, p.z);
      dummy.scale.set(p.s * 1.5, p.s * 0.6, p.s);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, puffs.out.length]} frustumCulled={false}>
      <sphereGeometry args={[1, 12, 8]} />
      <meshStandardMaterial color="#ffffff" roughness={1} transparent opacity={0.92} fog={false} />
    </instancedMesh>
  );
}

/** Sun/moon whose shadow frustum follows the player so shadows stay sharp wherever you walk. */
export function Sun({
  night,
  cityView,
  enabled,
  target,
}: {
  night: boolean;
  cityView: boolean;
  enabled: boolean;
  target: { x: number; z: number };
}) {
  const light = useRef<THREE.DirectionalLight>(null);
  const { scene } = useThree();
  const dir = useMemo(() => (night ? new THREE.Vector3(-60, 90, 40) : new THREE.Vector3(-80, 70, 50)), [night]);
  const range = cityView ? 280 : 85;
  useLayoutEffect(() => {
    const l = light.current;
    if (!l) return;
    const cam = l.shadow.camera;
    cam.left = -range;
    cam.right = range;
    cam.top = range;
    cam.bottom = -range;
    cam.near = 1;
    cam.far = 520;
    cam.updateProjectionMatrix();
    l.shadow.needsUpdate = true;
  }, [range]);
  useLayoutEffect(() => {
    const l = light.current;
    if (l) scene.add(l.target);
    return () => {
      if (l) scene.remove(l.target);
    };
  }, [scene]);
  useFrame(() => {
    const l = light.current;
    if (!l) return;
    // snap to the shadow texel grid to avoid shimmering while the frustum moves
    const texel = (range * 2) / 4096;
    const tx = cityView ? 0 : Math.round(target.x / texel) * texel;
    const tz = cityView ? 0 : Math.round(target.z / texel) * texel;
    l.target.position.set(tx, 0, tz);
    l.position.set(tx + dir.x, dir.y, tz + dir.z);
    l.target.updateMatrixWorld();
  });
  return (
    <directionalLight
      ref={light}
      intensity={night ? 0.9 : 2.3}
      color={night ? '#a9bcff' : '#ffe2b0'}
      castShadow={enabled}
      shadow-mapSize={[4096, 4096]}
      shadow-bias={-0.0003}
      shadow-normalBias={0.05}
    />
  );
}
