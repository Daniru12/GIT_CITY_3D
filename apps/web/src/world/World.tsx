import { Environment, Lightformer, Loader, Sky, Sparkles, Stars, Text } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { CapsuleCollider, CuboidCollider, Physics, RigidBody, useRapier } from '@react-three/rapier';
import type { RapierRigidBody } from '@react-three/rapier';
import { useQuery } from '@tanstack/react-query';
import { Book, CircleDot, Eye, Gem, GitCommitHorizontal, GitPullRequest, HelpCircle, Star, Users } from 'lucide-react';
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import * as THREE from 'three';
import {
  CITY_SEED,
  SLAB,
  THEMES,
  generateCity,
  languageColor,
  type City,
  type CityBuilding,
  type GithubRepoSummary,
  type GithubStats,
  type Mark,
  type PlotInfo,
  type Point,
} from '@gitcity/shared';
import { api } from '../lib/api';
import { useSession } from '../lib/auth';
import { LegoCars, Minifigs, RoofStuds, StudGrid, studTexture } from './lego';
import { Clouds, ISLAND_MARGIN, Island, Mountains, Sun, Water } from './scenery';
import { Avatar, animateAvatar, emptyRig, makeAnimState, type AvatarRig } from './avatar';
import { INTERIOR_SPAWN, INTERIOR_Y, Interior, filterRepos, floorCount, stackOf } from './Interior';
import { useWorld, type RepoSort } from './store';

const WALK = 7;
const SPRINT = 12;
const JUMP = 9;
const INTERACT_RANGE = 9;
const BUILD_SECONDS = 7;
const JUMP_WINDUP = 0.09; // seconds of crouch before take-off

/* ------------------------------ input ------------------------------ */
const keys = new Set<string>();
const look = { yaw: Math.PI, pitch: 0.35, dist: 12 };
const cityLook = { yaw: Math.PI / 4, pitch: 0.75, dist: 190 };
const emote = { name: 'none' as 'none' | 'wave' | 'dance' | 'cheer' };
const playerPos = { x: 0, y: 0, z: 0 };
/** Latest plot-id -> developer map, readable from the (non-React) key handler. */
const ownersLookup: { current: Map<string, CityBuilding>; plots: PlotInfo[] } = { current: new Map(), plots: [] };

function openRepo(url: string, name: string) {
  if (window.confirm(`Open ${name} on GitHub?`)) window.open(url, '_blank', 'noopener,noreferrer');
}

function useInput(canvasEl: HTMLElement | null) {
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      keys.add(e.code);
      const st = useWorld.getState();
      if (e.code === 'KeyE') {
        if (st.interior) {
          if (st.focus?.kind === 'door') st.exitInterior();
          else if (st.focus?.kind === 'repo') openRepo(st.focus.repo.url, st.focus.repo.name);
        } else {
          const owner = st.nearby ? ownersLookup.current.get(st.nearby.id) : undefined;
          if (owner && st.nearby && !st.cityView) {
            const p = st.nearby;
            st.enterInterior(owner, [p.x, 3, p.z + p.size / 2 + 5]);
          } else st.setPanel(st.panel ? null : st.nearby);
        }
      }
      if (e.code === 'Escape') {
        if (st.interior) st.exitInterior();
        else st.setPanel(null);
      }
      if (e.code === 'KeyC') st.toggleCityView();
      if (e.code === 'KeyN') st.toggleNight();
      if (e.code === 'Digit1') emote.name = 'wave';
      if (e.code === 'Digit2') emote.name = 'dance';
      if (e.code === 'Digit3') emote.name = 'cheer';
      if (e.code === 'KeyR') {
        Object.assign(look, { yaw: Math.PI, pitch: 0.35, dist: 12 });
        Object.assign(cityLook, { yaw: Math.PI / 4, pitch: 0.75, dist: 190 });
      }
      if (e.code === 'Space') e.preventDefault();
    };
    const up = (e: KeyboardEvent) => keys.delete(e.code);
    const blur = () => keys.clear();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  useEffect(() => {
    if (!canvasEl) return;
    let dragging = false;
    const pd = () => (dragging = true);
    const pu = () => (dragging = false);
    const pm = (e: PointerEvent) => {
      if (!dragging) return;
      const city = useWorld.getState().cityView;
      const l = city ? cityLook : look;
      l.yaw -= e.movementX * 0.005;
      l.pitch = THREE.MathUtils.clamp(l.pitch + e.movementY * 0.004, city ? 0.2 : 0.08, city ? 1.5 : 1.3);
    };
    const wh = (e: WheelEvent) => {
      if (useWorld.getState().cityView) cityLook.dist = THREE.MathUtils.clamp(cityLook.dist + e.deltaY * 0.15, 45, 360);
      else look.dist = THREE.MathUtils.clamp(look.dist + e.deltaY * 0.01, 5, 28);
    };
    canvasEl.addEventListener('pointerdown', pd);
    window.addEventListener('pointerup', pu);
    window.addEventListener('pointermove', pm);
    canvasEl.addEventListener('wheel', wh, { passive: true });
    return () => {
      canvasEl.removeEventListener('pointerdown', pd);
      window.removeEventListener('pointerup', pu);
      window.removeEventListener('pointermove', pm);
      canvasEl.removeEventListener('wheel', wh);
    };
  }, [canvasEl]);
}

/* ------------------------------ textures ------------------------------ */
// 4x4 "bays" per tile, one bay = 3 m. Colour map + emissive map (lit windows) share the same layout.
const texCache = new Map<string, THREE.CanvasTexture>();
function windowTexture(variant: number, lit: boolean, rx: number, ry: number): THREE.CanvasTexture {
  const key = `${variant}:${lit}:${rx}:${ry}`;
  const hit = texCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = lit ? '#000000' : '#ffffff';
  g.fillRect(0, 0, 128, 128);
  let seed = variant * 9301 + 49297;
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  for (let by = 0; by < 4; by++)
    for (let bx = 0; bx < 4; bx++) {
      const on = rnd() < 0.5;
      if (lit) {
        if (!on) continue;
        g.fillStyle = rnd() < 0.8 ? '#ffd27a' : '#fff1c4';
      } else {
        g.fillStyle = '#8ec5ee';
      }
      g.fillRect(bx * 32 + 7, by * 32 + 6, 18, 20);
      if (!lit) {
        g.strokeStyle = '#f4f4f0';
        g.lineWidth = 2;
        g.strokeRect(bx * 32 + 6, by * 32 + 5, 20, 22);
        g.beginPath();
        g.moveTo(bx * 32 + 16, by * 32 + 6);
        g.lineTo(bx * 32 + 16, by * 32 + 26);
        g.moveTo(bx * 32 + 7, by * 32 + 16);
        g.lineTo(bx * 32 + 25, by * 32 + 16);
        g.stroke();
      }
    }
  if (!lit) {
    // brick seams every 1 m
    g.strokeStyle = 'rgba(0,0,0,0.12)';
    g.lineWidth = 1;
    for (let y = 0; y < 128; y += 11) {
      g.beginPath();
      g.moveTo(0, y + 0.5);
      g.lineTo(128, y + 0.5);
      g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  texCache.set(key, t);
  return t;
}

/* ------------------------------ instancing helpers ------------------------------ */
function Instanced({
  points,
  geometry,
  color,
  offset,
  baseY = 0,
  emissive,
  roughness = 0.9,
  castShadow = true,
}: {
  points: Point[];
  geometry: THREE.BufferGeometry;
  color: string;
  offset: [number, number, number];
  baseY?: number;
  emissive?: string;
  roughness?: number;
  castShadow?: boolean;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const o = new THREE.Object3D();
    points.forEach((p, i) => {
      o.position.set(p.x + offset[0] * p.s, baseY + offset[1] * p.s, p.z + offset[2] * p.s);
      o.scale.setScalar(p.s);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
  }, [points, offset, baseY]);
  return (
    <instancedMesh
      key={points.length}
      ref={ref}
      args={[geometry, undefined, points.length]}
      castShadow={castShadow}
      frustumCulled={false}
    >
      <meshStandardMaterial color={color} emissive={emissive} emissiveIntensity={emissive ? 2 : 0} roughness={roughness} />
    </instancedMesh>
  );
}

function Marks({ marks, color, y }: { marks: Mark[]; color: string; y: number }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const o = new THREE.Object3D();
    marks.forEach((k, i) => {
      o.position.set(k.x, y, k.z);
      o.scale.set(k.w, 0.02, k.d);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
  }, [marks, y]);
  return (
    <instancedMesh key={marks.length} ref={ref} args={[undefined, undefined, marks.length]} frustumCulled={false} receiveShadow>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color={color} roughness={0.8} />
    </instancedMesh>
  );
}

/** Red/white striped kerb around each block, like the reference. */
function Curbs({ blocks }: { blocks: City['blocks'] }) {
  const red = useRef<THREE.InstancedMesh>(null);
  const white = useRef<THREE.InstancedMesh>(null);
  const segs = useMemo(() => {
    const out: { x: number; z: number; w: number; d: number; red: boolean }[] = [];
    const h = 16;
    const n = 20;
    const len = (h * 2) / n;
    for (const b of blocks)
      for (let i = 0; i < n; i++) {
        const t = -h + len * (i + 0.5);
        const r = i % 2 === 0;
        out.push({ x: b.x + t, z: b.z - h, w: len, d: 0.5, red: r });
        out.push({ x: b.x + t, z: b.z + h, w: len, d: 0.5, red: r });
        out.push({ x: b.x - h, z: b.z + t, w: 0.5, d: len, red: r });
        out.push({ x: b.x + h, z: b.z + t, w: 0.5, d: len, red: r });
      }
    return { red: out.filter((s) => s.red), white: out.filter((s) => !s.red) };
  }, [blocks]);
  useLayoutEffect(() => {
    const o = new THREE.Object3D();
    (['red', 'white'] as const).forEach((k) => {
      const m = (k === 'red' ? red : white).current;
      if (!m) return;
      segs[k].forEach((s, i) => {
        o.position.set(s.x, SLAB + 0.02, s.z);
        o.scale.set(s.w, 0.08, s.d);
        o.updateMatrix();
        m.setMatrixAt(i, o.matrix);
      });
      m.instanceMatrix.needsUpdate = true;
    });
  }, [segs]);
  return (
    <>
      <instancedMesh key={`r${segs.red.length}`} ref={red} args={[undefined, undefined, segs.red.length]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#cfc9ba" />
      </instancedMesh>
      <instancedMesh key={`w${segs.white.length}`} ref={white} args={[undefined, undefined, segs.white.length]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#f4efe6" />
      </instancedMesh>
    </>
  );
}

/* ------------------------------ traffic ------------------------------ */
function Cars({ city, night }: { city: City; night: boolean }) {
  const body = useRef<THREE.InstancedMesh>(null);
  const cabin = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const L = city.extent + 8;
  useLayoutEffect(() => {
    const m = body.current;
    if (!m) return;
    city.cars.forEach((c, i) => m.setColorAt(i, new THREE.Color(c.color)));
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [city.cars]);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    city.cars.forEach((c, i) => {
      const along = ((((c.phase * L + c.dir * c.speed * t) % L) + L) % L) - L / 2;
      const rc = city.roadLines[c.road];
      let ry: number;
      if (c.axis === 'z') {
        dummy.position.set(rc + c.lane, 0.55, along);
        ry = c.dir === 1 ? 0 : Math.PI;
      } else {
        dummy.position.set(along, 0.55, rc + c.lane);
        ry = c.dir === 1 ? Math.PI / 2 : -Math.PI / 2;
      }
      dummy.rotation.set(0, ry, 0);
      dummy.updateMatrix();
      body.current?.setMatrixAt(i, dummy.matrix);
      dummy.position.x -= Math.sin(ry) * 0.2;
      dummy.position.z -= Math.cos(ry) * 0.2;
      dummy.position.y = 1.15;
      dummy.updateMatrix();
      cabin.current?.setMatrixAt(i, dummy.matrix);
    });
    if (body.current) body.current.instanceMatrix.needsUpdate = true;
    if (cabin.current) cabin.current.instanceMatrix.needsUpdate = true;
  });
  const n = city.cars.length;
  return (
    <>
      <instancedMesh key={`b${n}`} ref={body} args={[undefined, undefined, n]} castShadow frustumCulled={false}>
        <boxGeometry args={[1.9, 0.7, 4]} />
        <meshStandardMaterial roughness={0.5} />
      </instancedMesh>
      <instancedMesh key={`c${n}`} ref={cabin} args={[undefined, undefined, n]} frustumCulled={false}>
        <boxGeometry args={[1.6, 0.6, 2]} />
        <meshStandardMaterial color="#bfe6ff" emissive={night ? '#ffe9a8' : '#000000'} emissiveIntensity={night ? 0.5 : 0} />
      </instancedMesh>
    </>
  );
}

/* ------------------------------ collectible gems ------------------------------ */
function Gems({ gems }: { gems: City['gems'] }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const collectedAt = useRef<Map<number, number>>(new Map());
  const dummy = useMemo(() => new THREE.Object3D(), []);
  useFrame(({ clock }) => {
    const m = ref.current;
    if (!m) return;
    const t = clock.elapsedTime;
    gems.forEach((g, i) => {
      const at = collectedAt.current.get(i);
      let visible = true;
      if (at !== undefined) {
        if (t - at > 30) collectedAt.current.delete(i);
        else visible = false;
      }
      if (visible && Math.abs(playerPos.x - g.x) < 1.8 && Math.abs(playerPos.z - g.z) < 1.8 && playerPos.y < 3.2) {
        collectedAt.current.set(i, t);
        useWorld.getState().addScore(1);
        visible = false;
      }
      dummy.position.set(g.x, 1.4 + Math.sin(t * 2 + i) * 0.25, g.z);
      dummy.rotation.set(0, t * 2 + i, 0);
      dummy.scale.setScalar(visible ? 1 : 0);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh key={gems.length} ref={ref} args={[undefined, undefined, gems.length]} frustumCulled={false}>
      <octahedronGeometry args={[0.55, 0]} />
      <meshStandardMaterial color="#38e8ff" emissive="#00b7ff" emissiveIntensity={1.6} flatShading />
    </instancedMesh>
  );
}

/* ------------------------------ buildings ------------------------------ */
/** Rooftop billboard listing the developer's real public projects (shown when the player is near). */
function ProjectBoard({ projects, x, z, width, color }: { projects: CityBuilding['projects']; x: number; z: number; width: number; color: string }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    if (ref.current) ref.current.visible = Math.hypot(x - playerPos.x, z - playerPos.z) < 70;
  });
  const rowH = 0.95;
  const h = projects.length * rowH + 1.5;
  const w = Math.max(6, width - 1);
  return (
    <group ref={ref} position={[0, 1.4 + h / 2, 0]}>
      <mesh position={[-w / 2 + 0.4, -h / 2 - 0.6, 0]}>
        <boxGeometry args={[0.2, 1.4, 0.2]} />
        <meshStandardMaterial color="#59627a" />
      </mesh>
      <mesh position={[w / 2 - 0.4, -h / 2 - 0.6, 0]}>
        <boxGeometry args={[0.2, 1.4, 0.2]} />
        <meshStandardMaterial color="#59627a" />
      </mesh>
      <mesh castShadow>
        <boxGeometry args={[w, h, 0.25]} />
        <meshStandardMaterial color="#0b1020" emissive={color} emissiveIntensity={0.06} />
      </mesh>
      <mesh position={[0, h / 2 - 0.05, 0.14]}>
        <boxGeometry args={[w, 0.12, 0.05]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.2} />
      </mesh>
      <Text position={[-w / 2 + 0.5, h / 2 - 0.55, 0.15]} fontSize={0.4} color="#9aa7c7" anchorX="left">
        PROJECTS
      </Text>
      {projects.map((r, i) => {
        const y = h / 2 - 1.25 - i * rowH;
        return (
          <group key={r.url} position={[0, y, 0.15]}>
            <mesh position={[-w / 2 + 0.6, 0, 0]}>
              <boxGeometry args={[0.45, 0.45, 0.06]} />
              <meshStandardMaterial color={languageColor(r.language)} emissive={languageColor(r.language)} emissiveIntensity={0.7} />
            </mesh>
            <Text position={[-w / 2 + 1.05, 0, 0]} fontSize={0.46} color="#ffffff" anchorX="left" maxWidth={w - 3}>
              {r.name.length > 20 ? `${r.name.slice(0, 19)}…` : r.name}
            </Text>
            <Text position={[w / 2 - 0.4, 0, 0]} fontSize={0.38} color="#f1e05a" anchorX="right">
              {`★ ${r.stars}`}
            </Text>
          </group>
        );
      })}
    </group>
  );
}

const nowSec = () => Date.now() / 1000;
const ease = (x: number) => 1 - Math.pow(1 - THREE.MathUtils.clamp(x, 0, 1), 3);

function AvatarBadge({ url }: { url: string }) {
  const [tex, setTex] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    let alive = true;
    new THREE.TextureLoader().setCrossOrigin('anonymous').load(
      url,
      (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        if (alive) setTex(t);
      },
      undefined,
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [url]);
  if (!tex) return null;
  return (
    <mesh position={[-1.6, 0, 0]}>
      <circleGeometry args={[0.7, 24]} />
      <meshBasicMaterial map={tex} />
    </mesh>
  );
}

function Building({
  p,
  night,
  owner,
  start,
  mine,
}: {
  p: PlotInfo;
  night: boolean;
  owner?: CityBuilding;
  start?: number;
  mine: boolean;
}) {
  const theme = owner ? (THEMES[owner.theme] ?? THEMES.mixed) : null;
  const bays = Math.max(1, Math.floor(p.size / 3));
  const floors = p.height / 3;
  const wallColor = theme ? theme.primary : p.color;
  const roofColor = theme ? theme.secondary : p.roofColor;
  const walls = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: wallColor,
        map: windowTexture(p.tex, false, bays / 4, floors / 4),
        emissive: new THREE.Color('#ffffff'),
        emissiveMap: windowTexture(p.tex, true, bays / 4, floors / 4),
        emissiveIntensity: 0,
        roughness: 0.4,
      }),
    [wallColor, p.tex, bays, floors],
  );
  const tier = p.height > 14;
  const upperFloors = tier ? 3 : 0;
  const upperSize = p.size * 0.72;
  const upperMat = useMemo(
    () =>
      tier
        ? new THREE.MeshStandardMaterial({
            color: wallColor,
            map: windowTexture(p.tex, false, Math.max(1, Math.floor(upperSize / 3)) / 4, upperFloors / 4),
            emissive: new THREE.Color('#ffffff'),
            emissiveMap: windowTexture(p.tex, true, Math.max(1, Math.floor(upperSize / 3)) / 4, upperFloors / 4),
            emissiveIntensity: 0,
            roughness: 0.4,
          })
        : null,
    [tier, wallColor, p.tex, upperSize, upperFloors],
  );
  const topH = p.height + upperFloors * 3;

  const wallsRef = useRef<THREE.Group>(null);
  const roofRef = useRef<THREE.Group>(null);
  const signRef = useRef<THREE.Group>(null);
  const sparkles = useRef<THREE.Group>(null);
  const done = useRef(start === undefined);

  const glow = night ? 1.5 : 0;
  useFrame(() => {
    const lit = (k: number) => {
      walls.emissiveIntensity = glow * k;
      if (upperMat) upperMat.emissiveIntensity = glow * k;
    };
    if (start === undefined) {
      lit(1);
      return;
    }
    const t = (nowSec() - start) / BUILD_SECONDS;
    if (t >= 1 && done.current) {
      lit(1);
      return;
    }
    done.current = false;
    const rise = ease((t - 0.12) / 0.55);
    if (wallsRef.current) wallsRef.current.scale.y = Math.max(0.001, rise);
    if (roofRef.current) {
      const drop = ease((t - 0.67) / 0.18);
      roofRef.current.visible = t > 0.67;
      roofRef.current.position.y = topH + (1 - drop) * 10;
    }
    lit(THREE.MathUtils.clamp((t - 0.82) / 0.18, 0, 1));
    if (signRef.current) signRef.current.visible = t > 0.85;
    if (sparkles.current) sparkles.current.visible = t < 1;
    if (t >= 1) {
      done.current = true;
      if (wallsRef.current) wallsRef.current.scale.y = 1;
      if (roofRef.current) roofRef.current.position.y = topH;
      if (mine) useWorld.getState().setWelcome(true);
    }
  });

  const hip = false;
  return (
    <group position={[p.x, SLAB, p.z]}>
      <mesh position={[0, 0.1, 0]} receiveShadow>
        <boxGeometry args={[p.size + 1.2, 0.2, p.size + 1.2]} />
        <meshStandardMaterial color="#cfc8bb" />
      </mesh>
      <group ref={wallsRef} scale={[1, start === undefined ? 1 : 0.001, 1]}>
        <mesh position={[0, p.height / 2, 0]} castShadow receiveShadow material={walls}>
          <boxGeometry args={[p.size, p.height, p.size]} />
        </mesh>
        {tier && upperMat && (
          <mesh position={[0, p.height + upperFloors * 1.5, 0]} castShadow material={upperMat}>
            <boxGeometry args={[upperSize, upperFloors * 3, upperSize]} />
          </mesh>
        )}
        <mesh position={[0, 1.2, p.size / 2 + 0.03]}>
          <boxGeometry args={[1.7, 2.4, 0.1]} />
          <meshStandardMaterial color="#3a2a22" emissive={night ? '#ffb454' : '#000000'} emissiveIntensity={night ? 0.5 : 0} />
        </mesh>
        <mesh position={[0, 2.7, p.size / 2 + 0.6]} castShadow>
          <boxGeometry args={[3, 0.18, 1.3]} />
          <meshStandardMaterial color={theme ? theme.secondary : '#c9473a'} />
        </mesh>
      </group>
      <group ref={roofRef} position={[0, topH, 0]} visible={start === undefined}>
        {hip ? (
          <mesh position={[0, 1.6, 0]} rotation-y={Math.PI / 4} castShadow>
            <coneGeometry args={[p.size * 0.78, 3.2, 4]} />
            <meshStandardMaterial color={roofColor} roughness={0.9} />
          </mesh>
        ) : (
          <>
            <mesh position={[0, 0.35, 0]} castShadow>
              <boxGeometry args={[(tier ? upperSize : p.size) + 0.6, 0.7, (tier ? upperSize : p.size) + 0.6]} />
              <meshStandardMaterial color={theme ? theme.secondary : p.color} roughness={0.35} />
            </mesh>
            {owner && owner.projects.length > 0 && (
              <ProjectBoard projects={owner.projects} x={p.x} z={p.z} width={tier ? upperSize : p.size} color={theme ? theme.primary : '#7c5cff'} />
            )}
            {owner && <StudGrid width={tier ? upperSize : p.size} y={0.84} color={theme ? theme.secondary : p.color} />}
            <mesh position={[1.2, 1.1, -1]} castShadow>
              <boxGeometry args={[1.6, 0.8, 1.6]} />
              <meshStandardMaterial color="#9aa3b5" />
            </mesh>
            {p.height >= 33 && (
              <group position={[-1.2, 0, 1]}>
                <mesh position={[0, 5, 0]} castShadow>
                  <cylinderGeometry args={[0.1, 0.18, 10, 6]} />
                  <meshStandardMaterial color="#c9ced8" metalness={0.6} roughness={0.35} />
                </mesh>
                <mesh position={[0, 10.2, 0]}>
                  <sphereGeometry args={[0.35, 10, 10]} />
                  <meshStandardMaterial color="#ff3b3b" emissive="#ff2020" emissiveIntensity={night ? 3 : 1} />
                </mesh>
              </group>
            )}
          </>
        )}
        {theme && (
          <mesh position={[0, hip ? 0.1 : 0.72, 0]}>
            <boxGeometry args={[(tier ? upperSize : p.size) + 0.9, 0.14, (tier ? upperSize : p.size) + 0.9]} />
            <meshStandardMaterial color={theme.primary} emissive={theme.primary} emissiveIntensity={night ? 2.2 : 0.5} />
          </mesh>
        )}
      </group>

      {owner && (
        <group ref={signRef} position={[0, 4.4, p.size / 2 + 0.9]} visible={start === undefined}>
          <Text fontSize={0.7} color="#ffffff" outlineWidth={0.07} outlineColor="#0b1020" anchorX="center">
            @{owner.ownerUsername}
          </Text>
          {owner.ownerAvatarUrl && <AvatarBadge url={owner.ownerAvatarUrl} />}
        </group>
      )}
      {start !== undefined && (
        <group ref={sparkles}>
          <Sparkles count={50} scale={[p.size + 3, 8, p.size + 3]} position={[0, 4, 0]} size={7} speed={1.4} color={theme?.primary ?? '#ffd27a'} />
        </group>
      )}
    </group>
  );
}

function Plaza({ night }: { night: boolean }) {
  const umbrellas = [
    [-8, 4],
    [8, 5],
    [-6, -8],
    [7, -7],
  ] as const;
  const colors = ['#e5484d', '#f5a623', '#3a7bd5', '#b5539c'];
  return (
    <group position={[0, SLAB, 0]}>
      <mesh position={[0, 0.1, 0]} receiveShadow>
        <cylinderGeometry args={[13, 13, 0.2, 40]} />
        <meshStandardMaterial color="#d9d4ff" />
      </mesh>
      <mesh position={[0, 0.9, 0]} castShadow>
        <cylinderGeometry args={[2.4, 2.8, 1.4, 20]} />
        <meshStandardMaterial color="#7c5cff" />
      </mesh>
      <mesh position={[0, 1.7, 0]}>
        <cylinderGeometry args={[1.8, 1.8, 0.2, 20]} />
        <meshStandardMaterial color="#00d4ff" emissive="#00d4ff" emissiveIntensity={night ? 1.2 : 0.3} />
      </mesh>
      <mesh position={[0, 3, 0]}>
        <sphereGeometry args={[0.9, 14, 14]} />
        <meshStandardMaterial color="#00d4ff" emissive="#00d4ff" emissiveIntensity={night ? 2 : 0.6} />
      </mesh>
      <Text position={[0, 6, 0]} fontSize={1.7} color="#ffffff" outlineWidth={0.07} outlineColor="#0b1020">
        GitCity Plaza
      </Text>
      {umbrellas.map(([x, z], i) => (
        <group key={i} position={[x, 0, z]}>
          <mesh position={[0, 1.2, 0]}>
            <cylinderGeometry args={[0.07, 0.07, 2.4, 6]} />
            <meshStandardMaterial color="#d8d8d8" />
          </mesh>
          <mesh position={[0, 2.6, 0]} castShadow>
            <coneGeometry args={[2, 0.9, 10]} />
            <meshStandardMaterial color={colors[i]} />
          </mesh>
          <mesh position={[0, 0.8, 0]} castShadow>
            <cylinderGeometry args={[0.8, 0.8, 0.1, 12]} />
            <meshStandardMaterial color="#8b5a2b" />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function City3D({
  city,
  night,
  owners,
  starts,
  mineId,
}: {
  city: City;
  night: boolean;
  owners: Map<string, CityBuilding>;
  starts: Map<string, number>;
  mineId: string | null;
}) {
  const { lowGfx } = useWorld();
  const trunk = useMemo(() => new THREE.CylinderGeometry(0.22, 0.32, 1.8, 6), []);
  const blob = useMemo(() => new THREE.CylinderGeometry(1.5, 1.7, 2.6, 10), []);
  const blob2 = useMemo(() => new THREE.CylinderGeometry(0.9, 1.1, 1.8, 10), []);
  const pole = useMemo(() => new THREE.CylinderGeometry(0.12, 0.15, 5, 6), []);
  const bulb = useMemo(() => new THREE.SphereGeometry(0.4, 8, 8), []);
  const pool = useMemo(() => new THREE.CircleGeometry(4.5, 20).rotateX(-Math.PI / 2), []);
  const half = city.extent / 2 + ISLAND_MARGIN;
  const cityView = useWorld((st) => st.cityView);
  const off = useMemo(
    () => ({
      trunk: [0, 0.9, 0] as [number, number, number],
      b1: [0, 2.8, 0] as [number, number, number],
      b2: [0.7, 3.9, 0.3] as [number, number, number],
      pole: [0, 2.5, 0] as [number, number, number],
      bulb: [0, 5.2, 0] as [number, number, number],
    }),
    [],
  );
  return (
    <>
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[half, 0.5, half]} position={[0, -0.5, 0]} />
        {city.blocks.map((b, i) => (
          <CuboidCollider key={i} args={[16, SLAB / 2, 16]} position={[b.x, SLAB / 2, b.z]} />
        ))}
        {city.plots.map((p) => {
          const h = p.height + (p.height > 14 ? 9 : 0);
          return <CuboidCollider key={p.id} args={[p.size / 2, h / 2, p.size / 2]} position={[p.x, SLAB + h / 2, p.z]} />;
        })}
        <CuboidCollider args={[3, 1, 3]} position={[0, 1 + SLAB, 0]} />
      </RigidBody>

      <Island extent={city.extent} night={night} />
      <Water night={night} />
      <Mountains extent={city.extent} night={night} />
      <Clouds extent={city.extent} />
      {city.roads.map((r, i) => (
        <mesh key={i} rotation-x={-Math.PI / 2} position={[r.x, 0.03, r.z]} receiveShadow>
          <planeGeometry args={[r.w, r.d]} />
          <meshStandardMaterial color={night ? '#2c3040' : '#5b5f68'} map={studTexture(r.w / 8, r.d / 8)} roughness={0.5} />
        </mesh>
      ))}
      {city.blocks.map((b, i) => (
        <mesh key={i} position={[b.x, SLAB / 2, b.z]} receiveShadow>
          <boxGeometry args={[32, SLAB, 32]} />
          <meshStandardMaterial color={night ? '#7b7e8e' : '#efe9dc'} map={studTexture(4, 4)} roughness={0.5} />
        </mesh>
      ))}
      <Curbs blocks={city.blocks} />
      <Marks marks={city.dashes} color="#f2d14c" y={0.06} />
      <Marks marks={city.crosswalks} color="#f4f1e6" y={0.06} />

      <Instanced points={city.trees} geometry={trunk} color="#7a4f2a" offset={off.trunk} baseY={SLAB} />
      <Instanced points={city.trees} geometry={blob} color={night ? '#3f9a54' : '#58b85a'} offset={off.b1} baseY={SLAB} roughness={1} />
      <Instanced points={city.trees} geometry={blob2} color={night ? '#56b866' : '#79d06a'} offset={off.b2} baseY={SLAB} roughness={1} />
      <Instanced points={city.lamps} geometry={pole} color="#2b3350" offset={off.pole} baseY={SLAB} />
      <Instanced points={city.lamps} geometry={bulb} color="#fff3b0" emissive="#ffd866" offset={off.bulb} baseY={SLAB} castShadow={false} />
      {night && (
        <instancedMesh
          key={city.lamps.length}
          args={[pool, undefined, city.lamps.length]}
          frustumCulled={false}
          ref={(m) => {
            if (!m) return;
            const o = new THREE.Object3D();
            city.lamps.forEach((l, i) => {
              o.position.set(l.x, SLAB + 0.06, l.z);
              o.updateMatrix();
              m.setMatrixAt(i, o.matrix);
            });
            m.instanceMatrix.needsUpdate = true;
          }}
        >
          <meshBasicMaterial color="#ffd27a" transparent opacity={0.22} depthWrite={false} blending={THREE.AdditiveBlending} />
        </instancedMesh>
      )}

      {city.plots.map((p) => (
        <Building key={p.id} p={p} night={night} owner={owners.get(p.id)} start={starts.get(p.id)} mine={owners.get(p.id)?.id === mineId} />
      ))}
      <Plaza night={night} />
      <LegoCars city={city} night={night} />
      <Minifigs city={city} />
      <RoofStuds plots={city.plots} owners={owners} />
      <Gems gems={city.gems} />

      {/* procedural studio-style reflections (no HDR download): gives glass, water and plastic real highlights */}
      <Environment resolution={128} frames={1} environmentIntensity={night ? 0.25 : 0.6}>
        <Lightformer form="rect" intensity={night ? 0.8 : 3} color={night ? '#8fa2ff' : '#fff1d6'} position={[-6, 8, 4]} scale={[14, 6, 1]} />
        <Lightformer form="rect" intensity={night ? 0.4 : 1.2} color={night ? '#4458a8' : '#bfe0ff'} position={[8, 3, -6]} scale={[10, 5, 1]} />
        <Lightformer form="ring" intensity={night ? 0.3 : 0.8} color="#ffffff" position={[0, 10, 0]} rotation-x={Math.PI / 2} scale={12} />
      </Environment>
      {night ? (
        <>
          <ambientLight intensity={0.35} color="#7f8fe0" />
          <hemisphereLight args={['#6f86d8', '#1c2540', 0.5]} />
        </>
      ) : (
        <>
          <ambientLight intensity={0.35} color="#ffd9b0" />
          <hemisphereLight args={['#cfe8ff', '#d9b98a', 0.5]} />
        </>
      )}
      <Sun night={night} cityView={cityView} enabled={!lowGfx} target={playerPos} />
    </>
  );
}

/* ------------------------------ player ------------------------------ */
function Player({ plots, spawn, nameLabel }: { plots: PlotInfo[]; spawn: [number, number, number]; nameLabel: string }) {
  const body = useRef<RapierRigidBody>(null);
  const rig = useRef<AvatarRig>(emptyRig());
  const animState = useRef(makeAnimState());
  const jumpRef = useRef({ t: 0, cool: 0 });
  const camTarget = useMemo(() => new THREE.Vector3(), []);
  const { camera } = useThree();
  const { world, rapier } = useRapier();
  const nearbyId = useRef<string | null>(null);
  const cityView = useWorld((st) => st.cityView);
  const snapCam = useRef(false);

  // teleport between the street and the building interior
  useEffect(
    () =>
      useWorld.subscribe((s, prev) => {
        const rb = body.current;
        if (!rb) return;
        if (s.warp && s.warp !== prev.warp && s.interior) {
          // HUD "go to project": stand in front of that garden, camera behind us
          rb.setTranslation({ x: s.warp.x, y: INTERIOR_Y + s.warp.y, z: s.warp.z }, true);
          rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
          Object.assign(look, { yaw: s.warp.yaw, pitch: 0.25, dist: 8 });
          snapCam.current = true;
          return;
        }
        if (s.interior === prev.interior) return;
        const to = s.interior ? INTERIOR_SPAWN : s.exitPos;
        rb.setTranslation({ x: to[0], y: to[1], z: to[2] }, true);
        rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
        Object.assign(look, s.interior ? { yaw: 0, pitch: 0.3, dist: 8 } : { yaw: Math.PI, pitch: 0.35, dist: 12 });
        snapCam.current = true;
      }),
    [],
  );

  useFrame((_, dt) => {
    const rb = body.current;
    if (!rb) return;
    const inside = useWorld.getState().interior !== null;
    const t = rb.translation();
    const v = rb.linvel();
    playerPos.x = t.x;
    playerPos.y = t.y;
    playerPos.z = t.z;

    if (useWorld.getState().cityView) {
      rb.setLinvel({ x: 0, y: v.y, z: 0 }, true);
      const cp0 = Math.cos(cityLook.pitch);
      const d0 = new THREE.Vector3(Math.sin(cityLook.yaw) * cp0, Math.sin(cityLook.pitch), Math.cos(cityLook.yaw) * cp0);
      camTarget.set(0, 0, 0);
      camera.position.lerp(camTarget.clone().addScaledVector(d0, cityLook.dist), 1 - Math.pow(0.001, dt));
      camera.lookAt(camTarget);
      return;
    }

    const f = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
    const s = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
    const speed = keys.has('ShiftLeft') || keys.has('ShiftRight') ? SPRINT : WALK;
    let dx = -Math.sin(look.yaw) * f + Math.cos(look.yaw) * s;
    let dz = -Math.cos(look.yaw) * f - Math.sin(look.yaw) * s;
    const len = Math.hypot(dx, dz);
    const moving = len > 0;
    if (moving) {
      emote.name = 'none';
      dx = (dx / len) * speed;
      dz = (dz / len) * speed;
    }

    // ground probe straight down (capsule bottom is 0.9 below its centre): works on flat ground, ramps and stairs
    const probe = world.castRayAndGetNormal(new rapier.Ray({ x: t.x, y: t.y, z: t.z }, { x: 0, y: -1, z: 0 }), 1.5, true, undefined, undefined, undefined, rb);
    const grounded = !!probe && probe.timeOfImpact < 1.08 && v.y < 3;
    let vy = v.y;
    let slope = 0;
    if (grounded && probe && probe.normal.y > 0.5) {
      // walk along the surface instead of into it: no sliding when idle, no hopping on ramps
      vy = moving ? -(probe.normal.x * dx + probe.normal.z * dz) / probe.normal.y : 0;
      if (moving) slope = Math.atan2(vy, speed);
    }

    // jump: short crouch (anticipation) then launch
    const J = jumpRef.current;
    if (J.cool > 0) J.cool -= dt;
    if (J.t <= 0 && keys.has('Space') && grounded && J.cool <= 0) J.t = JUMP_WINDUP;
    let windup = 0;
    if (J.t > 0) {
      J.t -= dt;
      windup = 1 - Math.max(J.t, 0) / JUMP_WINDUP;
      if (J.t <= 0) {
        vy = JUMP;
        J.cool = 0.2;
        windup = 0;
      }
    }
    rb.setLinvel({ x: dx, y: vy, z: dz }, true);

    animateAvatar(
      rig.current,
      animState.current,
      {
        targetSpeed: moving ? speed : 0,
        walkSpeed: WALK,
        sprintSpeed: SPRINT,
        grounded,
        vy: v.y,
        windup,
        slope,
        faceYaw: moving ? Math.atan2(dx, dz) : null,
        emote: emote.name,
      },
      dt,
    );
    if (inside ? t.y < INTERIOR_Y - 6 : t.y < -6) {
      if (inside) rb.setTranslation({ x: INTERIOR_SPAWN[0], y: INTERIOR_SPAWN[1], z: INTERIOR_SPAWN[2] }, true);
      else rb.setTranslation({ x: spawn[0], y: 3, z: spawn[2] }, true);
      rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
    }

    camTarget.set(t.x, t.y + 1.4, t.z);
    const cp = Math.cos(look.pitch);
    const dir = new THREE.Vector3(Math.sin(look.yaw) * cp, Math.sin(look.pitch), Math.cos(look.yaw) * cp);
    let dist = look.dist;
    const hit = world.castRay(new rapier.Ray(camTarget, dir), dist, true, undefined, undefined, undefined, rb);
    if (hit) dist = Math.max(1.5, hit.timeOfImpact - 0.4);
    const camGoal = camTarget.clone().addScaledVector(dir, dist);
    if (snapCam.current) {
      camera.position.copy(camGoal);
      snapCam.current = false;
    } else camera.position.lerp(camGoal, 1 - Math.pow(0.001, dt));
    camera.lookAt(camTarget);
    if (inside) return;

    let best: PlotInfo | null = null;
    let bestD = INTERACT_RANGE;
    for (const p of plots) {
      const d = Math.hypot(p.x - t.x, p.z - t.z) - p.size / 2;
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    const id = best?.id ?? null;
    if (id !== nearbyId.current) {
      nearbyId.current = id;
      useWorld.getState().setNearby(best);
      if (!best) useWorld.getState().setPanel(null);
    }
  });

  return (
    <RigidBody ref={body} position={spawn} colliders={false} enabledRotations={[false, false, false]} linearDamping={0.2} friction={0} ccd>
      <CapsuleCollider args={[0.5, 0.4]} friction={0} />
      <Avatar rig={rig} />
      <mesh position={[0, 7, 0]} rotation-x={Math.PI} scale={cityView ? 2.5 : 0} visible={cityView}>
        <coneGeometry args={[0.8, 2, 8]} />
        <meshStandardMaterial color="#ff3b6b" emissive="#ff3b6b" emissiveIntensity={1.4} />
      </mesh>
      <Text position={[0, 2.1, 0]} fontSize={0.34} color="#ffffff" outlineWidth={0.03} outlineColor="#0b1020">
        {nameLabel}
      </Text>
    </RigidBody>
  );
}

/* ------------------------------ HUD: profile card, minimap, guide ------------------------------ */
function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-bg/60 px-2 py-1.5">
      <span className="text-secondary">{icon}</span>
      <div className="leading-tight">
        <div className="text-base font-bold">{value.toLocaleString()}</div>
        <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
      </div>
    </div>
  );
}

function ProfileCard({
  user,
  building,
  stats,
  statsLoading,
}: {
  user: { username: string; avatarUrl: string | null; displayName: string | null } | null | undefined;
  building: CityBuilding | null | undefined;
  stats: GithubStats | null | undefined;
  statsLoading: boolean;
}) {
  const [open, setOpen] = useState(true);
  if (!user) {
    return (
      <div className="absolute left-4 top-16 w-72 rounded-xl bg-surface/90 p-4 text-sm backdrop-blur">
        <p className="font-semibold">You are exploring as a guest</p>
        <p className="mt-1 text-slate-300">Sign in with GitHub to get your own building and see your commits, pull requests and repositories here.</p>
        <Link to="/login" className="pointer-events-auto mt-3 inline-block rounded-lg bg-primary px-3 py-2 font-semibold">
          Sign in
        </Link>
      </div>
    );
  }
  const theme = building ? THEMES[building.theme] : null;
  const langs = stats ? Object.entries(stats.languages).sort((a, b) => b[1] - a[1]).slice(0, 5) : [];
  return (
    <div className="absolute left-4 top-16 w-72 max-h-[70vh] overflow-y-auto rounded-xl bg-surface/90 p-3 text-sm backdrop-blur">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-3 text-left">
        {user.avatarUrl ? (
          <img src={user.avatarUrl} alt="" className="h-10 w-10 rounded-full" />
        ) : (
          <div className="grid h-10 w-10 place-items-center rounded-full bg-primary font-bold">{user.username[0]?.toUpperCase()}</div>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate font-bold">{user.displayName ?? user.username}</div>
          <div className="truncate text-xs text-slate-400">@{user.username}</div>
        </div>
        <span className="text-xs text-slate-400">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          <div className="rounded-lg bg-bg/60 p-2 text-xs">
            <div className="text-slate-400">Your building</div>
            {building ? (
              <div className="mt-0.5 font-semibold" style={{ color: theme?.primary }}>
                {building.name} <span className="font-normal text-slate-400">· plot {building.slot}</span>
              </div>
            ) : (
              <div className="mt-0.5 text-amber-300">No building yet. Reload the page; it is created when you sign in.</div>
            )}
          </div>

          {statsLoading && <p className="text-xs text-slate-400">Loading your GitHub data…</p>}
          {!statsLoading && !stats && (
            <p className="rounded-lg bg-bg/60 p-2 text-xs text-slate-300">
              No GitHub data on this account. Developer-mode accounts are not connected to GitHub. Sign in with GitHub to see your commits, pull requests and repositories.
            </p>
          )}
          {stats && (
            <>
              <div className="text-[11px] uppercase tracking-wide text-slate-400">Public GitHub activity · last 12 months</div>
              <div className="grid grid-cols-2 gap-2">
                <Stat icon={<GitCommitHorizontal size={16} />} label="Commits" value={stats.commits} />
                <Stat icon={<GitPullRequest size={16} />} label="Pull requests" value={stats.pullRequests} />
                <Stat icon={<CircleDot size={16} />} label="Issues" value={stats.issues} />
                <Stat icon={<Eye size={16} />} label="Reviews" value={stats.reviews} />
              </div>
              <div className="text-[11px] uppercase tracking-wide text-slate-400">Profile</div>
              <div className="grid grid-cols-3 gap-2">
                <Stat icon={<Book size={16} />} label="Repos" value={stats.publicRepos} />
                <Stat icon={<Star size={16} />} label="Stars" value={stats.stars} />
                <Stat icon={<Users size={16} />} label="Followers" value={stats.followers} />
              </div>
              {langs.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {langs.map(([l, n]) => (
                    <span key={l} className="rounded-full bg-primary/20 px-2 py-0.5 text-xs">
                      {l} · {n}
                    </span>
                  ))}
                </div>
              )}
              {stats.topRepos.length > 0 && (
                <ul className="space-y-1">
                  {stats.topRepos.slice(0, 3).map((r) => (
                    <li key={r.url}>
                      <a href={r.url} target="_blank" rel="noopener noreferrer" className="pointer-events-auto block rounded-lg bg-bg/60 px-2 py-1.5 hover:bg-bg">
                        <div className="flex justify-between gap-2">
                          <span className="truncate font-semibold">{r.name}</span>
                          <span className="shrink-0 text-xs text-slate-400">★ {r.stars}</span>
                        </div>
                        {r.description && <div className="truncate text-xs text-slate-400">{r.description}</div>}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-[10px] text-slate-500">
                Public data only, as of {new Date(stats.syncedAt).toLocaleString()}. Sign in again to refresh. Your activity never changes your building&apos;s size.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Minimap({ city, owners, mineSlot }: { city: City; owners: Map<string, CityBuilding>; mineSlot: string | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const SIZE = 176;
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const g = c.getContext('2d');
    if (!g) return;
    const half = city.extent / 2 + 10;
    const k = SIZE / (2 * half);
    const X = (x: number) => (x + half) * k;
    const draw = () => {
      g.clearRect(0, 0, SIZE, SIZE);
      g.fillStyle = 'rgba(11,16,32,0.85)';
      g.fillRect(0, 0, SIZE, SIZE);
      g.fillStyle = '#2f364d';
      for (const b of city.blocks) g.fillRect(X(b.x - 16), X(b.z - 16), 32 * k, 32 * k);
      for (const p of city.plots) {
        const o = owners.get(p.id);
        g.fillStyle = o ? (THEMES[o.theme]?.primary ?? '#7c5cff') : '#5b627a';
        const s = Math.max(2, p.size * k * (o ? 1.25 : 0.9));
        g.fillRect(X(p.x) - s / 2, X(p.z) - s / 2, s, s);
        if (p.id === mineSlot) {
          g.strokeStyle = '#ffffff';
          g.lineWidth = 2;
          g.strokeRect(X(p.x) - s / 2 - 2, X(p.z) - s / 2 - 2, s + 4, s + 4);
        }
      }
      g.fillStyle = '#00d4ff';
      g.beginPath();
      g.arc(X(0), X(0), 6 * k * 2, 0, Math.PI * 2);
      g.fill();
      // you
      const px = X(playerPos.x);
      const pz = X(playerPos.z);
      g.fillStyle = '#ff3b6b';
      g.strokeStyle = '#ffffff';
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(px, pz, 4.5, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    };
    draw();
    const id = setInterval(draw, 120);
    return () => clearInterval(id);
  }, [city, owners, mineSlot]);
  return (
    <div className="pointer-events-none absolute bottom-4 right-4 rounded-xl bg-surface/80 p-2 backdrop-blur">
      <canvas ref={ref} width={SIZE} height={SIZE} className="block rounded-lg" />
      <div className="mt-1 flex gap-3 text-[10px] text-slate-300">
        <span><span className="text-[#ff3b6b]">●</span> you</span>
        <span><span className="text-white">▢</span> your building</span>
        <span><span className="text-primary">■</span> developers</span>
      </div>
    </div>
  );
}

function HelpOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div className="absolute inset-0 z-10 grid place-items-center bg-bg/70 p-4 backdrop-blur-sm">
      <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-surface p-6 shadow-2xl">
        <h2 className="text-2xl font-extrabold">What am I looking at?</h2>
        <p className="mt-2 text-slate-300">
          GitCity is a persistent 3D city built by real developers. Every developer who signs in with GitHub automatically gets exactly one building, and the city
          grows outwards as more developers join.
        </p>
        <ul className="mt-4 space-y-2 text-sm text-slate-200">
          <li><b className="text-primary">Glowing buildings with a @username sign</b> belong to real developers. The colour comes from their most-used public language.</li>
          <li><b>Plain buildings</b> are unclaimed city buildings. They are replaced when a new developer joins.</li>
          <li><b className="text-secondary">Cyan gems</b> are just for fun. Collect them for a score (not saved).</li>
          <li><b>Left card</b> shows your own public GitHub activity: commits, pull requests, issues, reviews, repos and stars from your last sign-in.</li>
          <li><b>Minimap</b> (bottom right) shows the whole city: red dot is you, white outline is your building.</li>
          <li><b>Top bar</b> shows how many real developers are in the city and how much of it is unlocked.</li>
        </ul>
        <p className="mt-4 text-sm text-slate-300">
          <b>Controls:</b> WASD move · Shift sprint · Space jump · drag to look · scroll to zoom · E interact · 1/2/3 emotes · C city view · N day/night · H this guide
        </p>
        <button onClick={onClose} className="mt-5 rounded-lg bg-primary px-5 py-2.5 font-semibold">
          Got it, let me explore
        </button>
      </div>
    </div>
  );
}

/* ------------------------------ interior HUD ------------------------------ */
function InteriorHud({
  building,
  projects,
  loading,
  focus,
}: {
  building: CityBuilding;
  projects: GithubRepoSummary[];
  loading: boolean;
  focus: ReturnType<typeof useWorld.getState>['focus'];
}) {
  const theme = THEMES[building.theme] ?? THEMES.mixed;
  const stack = useMemo(() => stackOf(projects), [projects]);
  const lang = useWorld((s) => s.lang);
  const q = useWorld((s) => s.q);
  const sort = useWorld((s) => s.sort);
  const selected = useWorld((s) => s.selected);
  const view = useMemo(() => filterRepos(projects, lang, q, sort), [projects, lang, q, sort]);
  const floor = useWorld((s) => s.floor);
  const floors = floorCount(view.length);
  const st = useWorld.getState;
  const chip = 'pointer-events-auto rounded-full px-2.5 py-1 text-[11px] font-semibold transition';
  return (
    <>
      <style>{`@keyframes gcFade{from{opacity:1}to{opacity:0}}`}</style>
      {/* fade-in from black every time the scene changes */}
      <div key={building.id} className="pointer-events-none absolute inset-0 z-20 bg-black" style={{ animation: 'gcFade 0.7s ease-out forwards' }} />

      <div className="pointer-events-auto absolute bottom-4 left-4 top-16 flex w-80 flex-col rounded-xl bg-surface/90 p-3 text-sm backdrop-blur">
        <div className="flex items-center gap-3">
          {building.ownerAvatarUrl && <img src={building.ownerAvatarUrl} alt="" className="h-10 w-10 rounded-full" />}
          <div className="min-w-0">
            <div className="truncate font-bold">@{building.ownerUsername}</div>
            <div className="truncate text-xs" style={{ color: theme.primary }}>
              {theme.label} · {projects.length} {projects.length === 1 ? 'project' : 'projects'}
            </div>
          </div>
          {floors > 1 && (
            <div className="ml-auto shrink-0 rounded-lg bg-bg/70 px-2.5 py-1 text-center text-[11px] leading-tight">
              <div className="text-slate-400">Floor</div>
              <div className="text-base font-bold">
                {floor + 1}/{floors}
              </div>
            </div>
          )}
        </div>

        <div className="mt-3 text-[11px] uppercase tracking-wide text-slate-400">Tech stack · click to filter</div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          <button onClick={() => st().setLang(null)} className={`${chip} ${lang === null ? 'bg-primary' : 'bg-bg/70 text-slate-300 hover:bg-bg'}`}>
            All · {projects.length}
          </button>
          {stack.map((s) => (
            <button
              key={s.lang}
              onClick={() => st().setLang(lang === s.lang ? null : s.lang)}
              className={`${chip} flex items-center gap-1.5 ${lang === s.lang ? 'bg-primary' : 'bg-bg/70 text-slate-300 hover:bg-bg'}`}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: languageColor(s.lang) }} />
              {s.lang} · {s.n}
            </button>
          ))}
        </div>

        <div className="mt-3 flex gap-2">
          <input
            value={q}
            onChange={(e) => st().setQuery(e.target.value)}
            placeholder="Search projects..."
            className="min-w-0 flex-1 rounded-lg bg-bg/70 px-2.5 py-1.5 text-xs outline-none ring-1 ring-white/10 focus:ring-primary"
          />
          <select
            value={sort}
            onChange={(e) => st().setSort(e.target.value as RepoSort)}
            className="rounded-lg bg-bg/70 px-2 py-1.5 text-xs outline-none ring-1 ring-white/10"
          >
            <option value="stars">Stars</option>
            <option value="recent">Recent</option>
            <option value="name">A-Z</option>
          </select>
        </div>

        <div className="mt-3 text-[11px] uppercase tracking-wide text-slate-400">
          {loading ? 'Loading projects...' : `Showing ${view.length} of ${projects.length} · click to walk there`}
        </div>
        <ul className="mt-1.5 min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
          {view.map((r) => (
            <li key={r.url}>
              <button
                onClick={() => st().jumpToRepo(r.url)}
                className={`w-full rounded-lg px-2 py-1.5 text-left transition hover:bg-bg ${selected?.url === r.url ? 'bg-bg ring-1 ring-primary' : 'bg-bg/50'}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: languageColor(r.language) }} />
                    <span className="truncate text-xs font-semibold">{r.name}</span>
                  </span>
                  <span className="shrink-0 text-[11px] text-slate-400">★ {r.stars}</span>
                </div>
              </button>
            </li>
          ))}
          {!loading && view.length === 0 && <li className="px-1 py-2 text-xs text-slate-400">No projects match.</li>}
        </ul>
      </div>

      <button
        onClick={() => st().exitInterior()}
        className="pointer-events-auto absolute right-4 top-4 rounded-lg bg-primary/90 px-3 py-2 text-sm font-semibold backdrop-blur"
      >
        Leave building (Esc)
      </button>

      {selected && (
        <div className="pointer-events-auto absolute bottom-4 right-4 w-80 rounded-2xl bg-surface/95 p-4 shadow-xl backdrop-blur">
          <div className="flex items-start gap-2">
            <span className="mt-1 h-3 w-3 shrink-0 rounded-sm" style={{ background: languageColor(selected.language) }} />
            <div className="min-w-0 flex-1">
              <div className="truncate font-bold">{selected.name}</div>
              <div className="text-xs text-slate-400">{selected.language ?? 'No language detected'}</div>
            </div>
            <button onClick={() => st().setSelected(null)} className="text-slate-400 hover:text-white" aria-label="Close">
              ✕
            </button>
          </div>
          <p className="mt-2 text-xs text-slate-300">{selected.description ?? 'No description.'}</p>
          <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-300">
            <span>★ {selected.stars}</span>
            {selected.forks !== undefined && <span>Forks {selected.forks}</span>}
            {selected.pushedAt && <span>Updated {new Date(selected.pushedAt).toLocaleDateString()}</span>}
          </div>
          {selected.topics && selected.topics.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {selected.topics.map((t) => (
                <button key={t} onClick={() => st().setQuery(t)} className="rounded-full bg-primary/20 px-2 py-0.5 text-[11px] hover:bg-primary/40">
                  {t}
                </button>
              ))}
            </div>
          )}
          <div className="mt-3 flex gap-2">
            <button onClick={() => openRepo(selected.url, selected.name)} className="flex-1 rounded-lg bg-primary px-3 py-2 text-xs font-semibold">
              Open on GitHub
            </button>
            <button onClick={() => st().jumpToRepo(selected.url)} className="rounded-lg bg-bg px-3 py-2 text-xs font-semibold">
              Go to garden
            </button>
          </div>
        </div>
      )}

      {focus?.kind === 'repo' && !selected && (
        <div className="pointer-events-none absolute bottom-24 left-1/2 w-72 -translate-x-1/2 rounded-2xl bg-surface/95 p-3 shadow-xl backdrop-blur">
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-sm" style={{ background: languageColor(focus.repo.language) }} />
            <span className="truncate font-bold">{focus.repo.name}</span>
            <span className="ml-auto text-xs text-slate-300">★ {focus.repo.stars}</span>
          </div>
          <p className="mt-1.5 text-xs font-semibold text-secondary">Click the garden for details · E opens GitHub</p>
        </div>
      )}
      {focus?.kind === 'door' && (
        <div className="pointer-events-none absolute bottom-24 left-1/2 -translate-x-1/2 rounded-full bg-primary px-4 py-2 text-sm font-semibold">
          Press E to go outside
        </div>
      )}
    </>
  );
}

/* ------------------------------ page ------------------------------ */
export default function World() {
  const session = useSession();
  const cityQ = useQuery({ queryKey: ['city'], queryFn: api.city, refetchInterval: 10_000, retry: 1 });
  const mineQ = useQuery({
    queryKey: ['my-building', session.data?.id],
    queryFn: api.myBuilding,
    enabled: !!session.data,
  });
  const { nearby, panel, lowGfx, toggleLowGfx, cityView, toggleCityView, night, toggleNight, score, welcome } = useWorld();
  const wrap = useRef<HTMLDivElement>(null);
  const [el, setEl] = useState<HTMLElement | null>(null);
  useInput(el);

  const statsQ = useQuery({ queryKey: ['gh-stats', session.data?.id], queryFn: api.githubStats, enabled: !!session.data });
  const [help, setHelp] = useState(() => {
    try {
      return localStorage.getItem('gitcity_help_seen') !== '1';
    } catch {
      return true;
    }
  });
  const closeHelp = () => {
    setHelp(false);
    try {
      localStorage.setItem('gitcity_help_seen', '1');
    } catch {
      /* storage unavailable: guide simply shows again next visit */
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.code === 'KeyH') setHelp((h) => !h);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const snapshot = cityQ.data;
  const radius = snapshot?.radius ?? 1;
  const city = useMemo(() => generateCity(snapshot?.seed ?? CITY_SEED, radius), [snapshot?.seed, radius]);
  const owners = useMemo(() => new Map((snapshot?.buildings ?? []).map((b) => [b.slot, b])), [snapshot]);
  const mineId = mineQ.data?.building?.id ?? null;

  // construction animation: buildings that are new (< 20 s old, or appear while watching) get built on screen
  const seen = useRef<Set<string> | null>(null);
  const startsRef = useRef<Map<string, number>>(new Map());
  const starts = useMemo(() => {
    const map = startsRef.current;
    const now = Date.now() / 1000;
    const first = seen.current === null;
    seen.current ??= new Set();
    for (const b of snapshot?.buildings ?? []) {
      if (seen.current.has(b.id)) continue;
      seen.current.add(b.id);
      const age = now - new Date(b.createdAt).getTime() / 1000;
      if (age < 20) map.set(b.slot, now - Math.max(0, age));
      else if (!first) map.set(b.slot, now);
    }
    return new Map(map);
  }, [snapshot]);

  const spawn = useMemo<[number, number, number]>(() => {
    const slot = mineQ.data?.building?.slot;
    const p = slot ? city.plots.find((q) => q.id === slot) : null;
    return p ? [p.x, 3, p.z + p.size / 2 + 5] : [0, 3, 14];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mineQ.data?.building?.slot]);

  const ready = !!snapshot && (!session.data || !mineQ.isLoading);

  // first login: fly over the city while the building goes up, then walk
  const intro = useRef(false);
  useEffect(() => {
    const b = mineQ.data?.building;
    if (!b || intro.current) return;
    if (Date.now() - new Date(b.createdAt).getTime() < 20_000) {
      intro.current = true;
      useWorld.setState({ cityView: true });
      const t = setTimeout(() => useWorld.setState({ cityView: false }), 6000);
      return () => clearTimeout(t);
    }
  }, [mineQ.data]);
  useEffect(() => {
    if (!welcome) return;
    const t = setTimeout(() => useWorld.getState().setWelcome(false), 5000);
    return () => clearTimeout(t);
  }, [welcome]);

  useEffect(() => {
    setEl(wrap.current);
    return () => {
      keys.clear();
      useWorld.setState({ nearby: null, panel: null, cityView: false, welcome: false });
    };
  }, []);

  ownersLookup.current = owners;
  ownersLookup.plots = city.plots;
  const interior = useWorld((st) => st.interior);
  const focus = useWorld((st) => st.focus);
  // full project list for the building we are inside (the city snapshot only carries the top few)
  const projectsQ = useQuery({
    queryKey: ['building-projects', interior?.id],
    queryFn: () => api.buildingProjects(interior!.id),
    enabled: !!interior,
    staleTime: 60_000,
  });
  const allProjects = projectsQ.data?.projects ?? interior?.projects ?? [];
  const bg = interior ? '#17131f' : night ? '#0a1230' : '#bcdcf5';
  const panelOwner = panel ? owners.get(panel.id) : undefined;

  return (
    <div ref={wrap} className="relative h-screen w-screen overflow-hidden bg-bg select-none">
      {ready && (
        <Canvas
          shadows={!lowGfx}
          dpr={lowGfx ? 1 : [1.5, 2]}
          gl={{ antialias: true, powerPreference: 'high-performance' }}
          camera={{ fov: 60, near: 0.1, far: 1500, position: [spawn[0], 8, spawn[2] + 14] }}
        >
          <color attach="background" args={[bg]} />
          <fog attach="fog" args={interior ? [bg, 60, 220] : [bg, cityView ? 700 : 140, cityView ? 1700 : 720]} />
          {!interior && (night ? <Stars radius={300} depth={60} count={2500} factor={5} fade /> : <Sky sunPosition={[-80, 40, 50]} turbidity={6} rayleigh={1.2} />)}
          <Suspense fallback={null}>
            <Physics gravity={[0, -28, 0]}>
              <group visible={!interior}>
                <City3D city={city} night={night} owners={owners} starts={starts} mineId={mineId} />
              </group>
              {interior && <Interior building={interior} projects={allProjects} player={playerPos} />}
              <Player plots={city.plots} spawn={spawn} nameLabel={session.data ? `@${session.data.username}` : 'Guest'} />
            </Physics>
          </Suspense>
        </Canvas>
      )}
      <Loader />
      {!ready && !cityQ.isError && <p className="absolute inset-0 grid place-items-center text-slate-300">Loading the city…</p>}
      {cityQ.isError && (
        <p role="alert" className="absolute inset-0 grid place-items-center px-6 text-center text-red-300">
          Could not load the city from the server. Make sure the API is running (pnpm start:local), then reload.
        </p>
      )}

      <div className="pointer-events-none absolute left-4 top-4 flex flex-wrap items-center gap-2">
        <Link to="/" className="pointer-events-auto rounded-lg bg-surface/80 px-3 py-2 text-sm font-semibold backdrop-blur">
          ← GitCity 3D
        </Link>
        <button onClick={toggleCityView} className="pointer-events-auto rounded-lg bg-primary/90 px-3 py-2 text-sm font-semibold backdrop-blur">
          {cityView ? 'Walk View (C)' : 'City View (C)'}
        </button>
        <button onClick={toggleNight} className="pointer-events-auto rounded-lg bg-surface/80 px-3 py-2 text-sm backdrop-blur">
          {night ? 'Night (N)' : 'Day (N)'}
        </button>
        <button onClick={() => setHelp(true)} className="pointer-events-auto flex items-center gap-1 rounded-lg bg-surface/80 px-3 py-2 text-sm backdrop-blur">
          <HelpCircle size={15} /> Guide (H)
        </button>
        <button onClick={toggleLowGfx} className="pointer-events-auto rounded-lg bg-surface/80 px-3 py-2 text-sm backdrop-blur">
          Graphics: {lowGfx ? 'Low' : 'High'}
        </button>
      </div>

      <div className="pointer-events-none absolute left-1/2 top-4 flex -translate-x-1/2 items-center gap-2 rounded-full bg-surface/80 px-4 py-2 text-sm font-semibold backdrop-blur">
        <span>GitCity</span>
        <span className="font-normal text-slate-300">
          · {snapshot?.developers ?? 0} {snapshot?.developers === 1 ? 'developer' : 'developers'} · {city.plots.length} plots · {radius} {radius === 1 ? 'ring' : 'rings'} unlocked
        </span>
        <Gem size={16} className="ml-2 text-secondary" /> {score}
      </div>

      {ready && !interior && (
        <>
          <ProfileCard user={session.data} building={mineQ.data?.building} stats={statsQ.data?.stats} statsLoading={statsQ.isLoading} />
          <Minimap city={city} owners={owners} mineSlot={mineQ.data?.building?.slot ?? null} />
        </>
      )}
      {interior && <InteriorHud building={interior} projects={allProjects} loading={projectsQ.isLoading} focus={focus} />}
      {help && <HelpOverlay onClose={closeHelp} />}

      {welcome && (
        <div className="pointer-events-none absolute left-1/2 top-24 -translate-x-1/2 rounded-2xl bg-primary px-8 py-4 text-2xl font-extrabold shadow-2xl">
          Welcome to GitCity!
        </div>
      )}

      <div className="pointer-events-none absolute bottom-4 left-4 max-w-[90vw] rounded-lg bg-surface/80 p-3 text-xs leading-5 backdrop-blur">
        {cityView ? (
          <>
            <b>Drag</b> rotate · <b>Scroll</b> zoom · <b>C</b> back to walking · <b>R</b> reset
          </>
        ) : (
          <>
            <b>WASD</b> move · <b>Shift</b> sprint · <b>Space</b> jump · <b>Drag</b> look · <b>Scroll</b> zoom · <b>E</b> interact ·{' '}
            <b>1</b> wave · <b>2</b> dance · <b>3</b> cheer · <b>C</b> city view · <b>N</b> day/night · collect the{' '}
            <span className="text-secondary">cyan gems</span>
          </>
        )}
      </div>

      {nearby && !panel && !cityView && !interior && (
        <div className="pointer-events-none absolute bottom-24 left-1/2 -translate-x-1/2 rounded-full bg-primary px-4 py-2 text-sm font-semibold">
          {owners.has(nearby.id) ? `Press E to enter · ${owners.get(nearby.id)?.name}` : `Press E · ${nearby.name}`}
        </div>
      )}
      {panel && (
        <div className="absolute right-4 top-4 w-72 rounded-xl bg-surface/95 p-4 shadow-xl backdrop-blur">
          {panelOwner ? (
            <>
              <h2 className="text-lg font-bold">{panelOwner.name}</h2>
              <p className="mt-1 text-sm text-slate-300">
                {THEMES[panelOwner.theme]?.label ?? 'Polyglot Tower'} · owned by @{panelOwner.ownerUsername}
              </p>
              <p className="mt-1 text-xs text-slate-400">Since {new Date(panelOwner.createdAt).toLocaleDateString()}</p>
              <div className="mt-3 text-[11px] uppercase tracking-wide text-slate-400">Projects</div>
              {panelOwner.projects.length === 0 ? (
                <p className="mt-1 text-xs text-slate-400">No public projects to show.</p>
              ) : (
                <ul className="mt-1 space-y-1">
                  {panelOwner.projects.map((r) => (
                    <li key={r.url}>
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => {
                          if (!window.confirm(`Open ${r.name} on GitHub?`)) e.preventDefault();
                        }}
                        className="pointer-events-auto block rounded-lg bg-bg/60 px-2 py-1.5 hover:bg-bg"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: languageColor(r.language) }} />
                            <span className="truncate font-semibold">{r.name}</span>
                          </span>
                          <span className="shrink-0 text-xs text-slate-400">★ {r.stars}</span>
                        </div>
                        {r.description && <div className="truncate text-xs text-slate-400">{r.description}</div>}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
              {panelOwner.ownerAvatarUrl && (
                <a
                  href={`https://github.com/${panelOwner.ownerUsername}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="pointer-events-auto mt-3 inline-block rounded-lg bg-primary px-3 py-2 text-sm font-semibold"
                >
                  View GitHub profile
                </a>
              )}
            </>
          ) : (
            <>
              <h2 className="text-lg font-bold">{panel.name}</h2>
              <p className="mt-1 text-sm text-slate-300">City building · no developer yet</p>
              <p className="mt-2 text-sm text-slate-400">
                New developers are assigned plots automatically when they sign in, starting from the centre of the city.
              </p>
              {!session.data && (
                <Link to="/login" className="pointer-events-auto mt-3 inline-block rounded-lg bg-primary px-3 py-2 text-sm font-semibold">
                  Sign in to get your building
                </Link>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
