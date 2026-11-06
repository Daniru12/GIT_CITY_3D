import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { SLAB, type City, type CityBuilding, type PlotInfo } from '@gitcity/shared';

/* Toy-brick look: studded plates, studded roofs, boxy vehicles with wheels, minifigure pedestrians. */

/* ------------------------------ studded plate texture ------------------------------ */
const studCache = new Map<string, THREE.CanvasTexture>();
/** Grey-scale 4x4 stud tile (multiplied by the material colour). One tile = 8 m, one stud = 2 m. */
export function studTexture(rx: number, ry: number): THREE.CanvasTexture {
  const key = `${rx.toFixed(2)}:${ry.toFixed(2)}`;
  const hit = studCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#e4e4e4';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) {
      const cx = i * 64 + 32;
      const cy = j * 64 + 32;
      g.fillStyle = '#b4b4b4'; // soft shadow
      g.beginPath();
      g.arc(cx + 3, cy + 4, 22, 0, Math.PI * 2);
      g.fill();
      const grad = g.createRadialGradient(cx - 6, cy - 7, 2, cx, cy, 22);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(1, '#d2d2d2');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(cx, cy, 20, 0, Math.PI * 2);
      g.fill();
    }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  studCache.set(key, t);
  return t;
}

/* ------------------------------ roof studs ------------------------------ */
const studGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.28, 10);

function studPositions(width: number): [number, number][] {
  const n = Math.max(1, Math.floor(width / 1.7));
  const step = width / n;
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) out.push([(i + 0.5) * step - width / 2, (j + 0.5) * step - width / 2]);
  return out;
}

/** Studs on one building's roof (used for developer-owned buildings, which animate). */
export function StudGrid({ width, y, color }: { width: number; y: number; color: string }) {
  const pos = useMemo(() => studPositions(width), [width]);
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const o = new THREE.Object3D();
    pos.forEach(([x, z], i) => {
      o.position.set(x, 0, z);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
  }, [pos]);
  return (
    <instancedMesh key={pos.length} ref={ref} args={[studGeo, undefined, pos.length]} position={[0, y, 0]} castShadow>
      <meshStandardMaterial color={color} roughness={0.35} />
    </instancedMesh>
  );
}

/** Studs on every unowned (scenery) building roof, in one instanced draw call. */
export function RoofStuds({ plots, owners }: { plots: PlotInfo[]; owners: Map<string, CityBuilding> }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const items = useMemo(() => {
    const out: { x: number; y: number; z: number; color: string }[] = [];
    for (const p of plots) {
      if (owners.has(p.id)) continue;
      const tier = p.height > 14;
      const width = tier ? p.size * 0.72 : p.size;
      const y = SLAB + p.height + (tier ? 9 : 0) + 0.7 + 0.14;
      for (const [dx, dz] of studPositions(width)) out.push({ x: p.x + dx, y, z: p.z + dz, color: p.color });
    }
    return out;
  }, [plots, owners]);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const o = new THREE.Object3D();
    const col = new THREE.Color();
    items.forEach((s, i) => {
      o.position.set(s.x, s.y, s.z);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      m.setColorAt(i, col.set(s.color));
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [items]);
  return (
    <instancedMesh key={items.length} ref={ref} args={[studGeo, undefined, items.length]} castShadow frustumCulled={false}>
      <meshStandardMaterial roughness={0.35} />
    </instancedMesh>
  );
}

/* ------------------------------ vehicles ------------------------------ */
const KIND = {
  car: { body: [1.9, 0.8, 4.0], by: 0.55, bz: 0, cab: [1.6, 0.65, 2.0], cy: 1.25, cz: -0.2, wx: 0.95, wz: 1.3, color: '', cabColor: '#a8d8f5' },
  truck: { body: [2.4, 1.9, 4.6], by: 1.35, bz: -0.9, cab: [2.3, 1.5, 1.7], cy: 1.2, cz: 2.2, wx: 1.2, wz: 1.9, color: '#0055bf', cabColor: '#f2f3f2' },
  bus: { body: [2.5, 2.2, 8.5], by: 1.55, bz: 0, cab: [2.56, 0.8, 7.6], cy: 2.0, cz: 0, wx: 1.25, wz: 2.9, color: '#f2f3f2', cabColor: '#7fc4f0' },
} as const;

export function LegoCars({ city, night }: { city: City; night: boolean }) {
  const body = useRef<THREE.InstancedMesh>(null);
  const cab = useRef<THREE.InstancedMesh>(null);
  const wheels = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const wheelGeo = useMemo(() => new THREE.CylinderGeometry(0.45, 0.45, 0.35, 12).rotateZ(Math.PI / 2), []);
  const L = city.extent + 8;
  const n = city.cars.length;

  useLayoutEffect(() => {
    const col = new THREE.Color();
    city.cars.forEach((c, i) => {
      const k = KIND[c.kind];
      body.current?.setColorAt(i, col.set(k.color || c.color));
      cab.current?.setColorAt(i, col.set(k.cabColor));
    });
    if (body.current?.instanceColor) body.current.instanceColor.needsUpdate = true;
    if (cab.current?.instanceColor) cab.current.instanceColor.needsUpdate = true;
  }, [city.cars]);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    city.cars.forEach((c, i) => {
      const k = KIND[c.kind];
      const along = ((((c.phase * L + c.dir * c.speed * t) % L) + L) % L) - L / 2;
      const rc = city.roadLines[c.road];
      const px = c.axis === 'z' ? rc + c.lane : along;
      const pz = c.axis === 'z' ? along : rc + c.lane;
      const ry = c.axis === 'z' ? (c.dir === 1 ? 0 : Math.PI) : c.dir === 1 ? Math.PI / 2 : -Math.PI / 2;
      const s = Math.sin(ry);
      const co = Math.cos(ry);
      const put = (m: THREE.InstancedMesh | null, idx: number, lx: number, ly: number, lz: number, sx: number, sy: number, sz: number) => {
        if (!m) return;
        dummy.position.set(px + co * lx + s * lz, ly, pz - s * lx + co * lz);
        dummy.rotation.set(0, ry, 0);
        dummy.scale.set(sx, sy, sz);
        dummy.updateMatrix();
        m.setMatrixAt(idx, dummy.matrix);
      };
      put(body.current, i, 0, k.by, k.bz, k.body[0], k.body[1], k.body[2]);
      put(cab.current, i, 0, k.cy, k.cz, k.cab[0], k.cab[1], k.cab[2]);
      put(wheels.current, i * 4, k.wx, 0.45, k.wz, 1, 1, 1);
      put(wheels.current, i * 4 + 1, -k.wx, 0.45, k.wz, 1, 1, 1);
      put(wheels.current, i * 4 + 2, k.wx, 0.45, -k.wz, 1, 1, 1);
      put(wheels.current, i * 4 + 3, -k.wx, 0.45, -k.wz, 1, 1, 1);
    });
    for (const m of [body.current, cab.current, wheels.current]) if (m) m.instanceMatrix.needsUpdate = true;
  });

  return (
    <>
      <instancedMesh key={`b${n}`} ref={body} args={[undefined, undefined, n]} castShadow frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial roughness={0.35} />
      </instancedMesh>
      <instancedMesh key={`c${n}`} ref={cab} args={[undefined, undefined, n]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial roughness={0.2} emissive={night ? '#ffe9a8' : '#000000'} emissiveIntensity={night ? 0.35 : 0} />
      </instancedMesh>
      <instancedMesh key={`w${n}`} ref={wheels} args={[wheelGeo, undefined, n * 4]} frustumCulled={false}>
        <meshStandardMaterial color="#1b1b1f" roughness={0.8} />
      </instancedMesh>
    </>
  );
}

/* ------------------------------ minifigure pedestrians ------------------------------ */
const SHIRTS = ['#c91a09', '#0055bf', '#237841', '#fe8a18', '#f2f3f2', '#7c5cff'];
const hash = (k: number) => {
  const x = Math.sin(k * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

export function Minifigs({ city, count = 60 }: { city: City; count?: number }) {
  const torso = useRef<THREE.InstancedMesh>(null);
  const head = useRef<THREE.InstancedMesh>(null);
  const legs = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const walkers = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        block: city.blocks[Math.floor(hash(i + 1) * city.blocks.length)],
        phase: hash(i + 50),
        speed: 1.2 + hash(i + 90) * 1.2,
        dir: hash(i + 130) < 0.5 ? 1 : -1,
        shirt: SHIRTS[Math.floor(hash(i + 170) * SHIRTS.length)],
      })),
    [city.blocks, count],
  );
  useLayoutEffect(() => {
    const col = new THREE.Color();
    walkers.forEach((w, i) => torso.current?.setColorAt(i, col.set(w.shirt)));
    if (torso.current?.instanceColor) torso.current.instanceColor.needsUpdate = true;
  }, [walkers]);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const h = 15.3;
    const per = 8 * h;
    walkers.forEach((w, i) => {
      const s = (((w.phase * per + w.dir * w.speed * t) % per) + per) % per;
      const side = Math.floor(s / (2 * h));
      const u = s - side * 2 * h - h;
      let x = w.block.x;
      let z = w.block.z;
      let hx = 0;
      let hz = 0;
      if (side === 0) ((x += u), (z -= h), (hx = 1));
      else if (side === 1) ((x += h), (z += u), (hz = 1));
      else if (side === 2) ((x -= u), (z += h), (hx = -1));
      else ((x -= h), (z -= u), (hz = -1));
      const yaw = Math.atan2(hx * w.dir, hz * w.dir);
      const bob = Math.abs(Math.sin(t * 6 + i)) * 0.06;
      const put = (m: THREE.InstancedMesh | null, y: number, sx: number, sy: number, sz: number) => {
        if (!m) return;
        dummy.position.set(x, SLAB + y + bob, z);
        dummy.rotation.set(0, yaw, 0);
        dummy.scale.set(sx, sy, sz);
        dummy.updateMatrix();
        m.setMatrixAt(i, dummy.matrix);
      };
      put(legs.current, 0.3, 0.5, 0.6, 0.3);
      put(torso.current, 0.9, 0.6, 0.6, 0.34);
      put(head.current, 1.35, 0.4, 0.3, 0.4);
    });
    for (const m of [torso.current, head.current, legs.current]) if (m) m.instanceMatrix.needsUpdate = true;
  });

  return (
    <>
      <instancedMesh ref={legs} args={[undefined, undefined, count]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#0055bf" roughness={0.4} />
      </instancedMesh>
      <instancedMesh ref={torso} args={[undefined, undefined, count]} castShadow frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial roughness={0.4} />
      </instancedMesh>
      <instancedMesh ref={head} args={[undefined, undefined, count]} frustumCulled={false}>
        <cylinderGeometry args={[0.5, 0.5, 1, 12]} />
        <meshStandardMaterial color="#f2cd37" roughness={0.3} />
      </instancedMesh>
    </>
  );
}
