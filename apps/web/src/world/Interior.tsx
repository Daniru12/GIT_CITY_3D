import { Billboard, RoundedBox, Text } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { CuboidCollider, RigidBody } from '@react-three/rapier';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { THEMES, languageColor, type CityBuilding, type GithubRepoSummary } from '@gitcity/shared';
import { useWorld, type InteriorFocus, type RepoSort } from './store';

/**
 * Developer HQ: a multi-storey house.
 * - Ground floor: lobby with the rotating tech-stack tower and the first 8 projects.
 * - Every further floor holds 8 more projects; switchback staircases at the back of the house lead up.
 * - Each project is an exhibit: living-wall garden, glowing star arc (one star per GitHub star, max 10), language monolith,
 *   topic tags and a sign. Hover / click are R3F pointer events; filtering, search and "walk me there" live in the HUD.
 * Lives high above the city (INTERIOR_Y) so it never overlaps the street scene.
 */
export const INTERIOR_Y = 800;
export const INTERIOR_SPAWN: [number, number, number] = [0, INTERIOR_Y + 1.6, 25];

const W = 44; // x: -22..22
const FH = 10; // floor-to-floor height
const Z_BACK = -30;
const Z_FRONT = 30;
const DOOR_Z = 27;
const PER_FLOOR = 8;
const MAX_PROJECTS = 60;
const STAIR_RUN = 20;
const STEPS = 20;
const TOWER_Z = 10;

const rnd = (k: number) => {
  const x = Math.sin(k * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/* ------------------------------ shared view logic (3D house + HUD list) ------------------------------ */
export function filterRepos(projects: GithubRepoSummary[], lang: string | null, q: string, sort: RepoSort): GithubRepoSummary[] {
  const needle = q.trim().toLowerCase();
  const out = projects.filter((r) => {
    if (lang && (r.language ?? 'Other') !== lang) return false;
    if (!needle) return true;
    return (
      r.name.toLowerCase().includes(needle) ||
      (r.description ?? '').toLowerCase().includes(needle) ||
      (r.topics ?? []).some((t) => t.toLowerCase().includes(needle))
    );
  });
  const by: Record<RepoSort, (a: GithubRepoSummary, b: GithubRepoSummary) => number> = {
    stars: (a, b) => b.stars - a.stars || a.name.localeCompare(b.name),
    recent: (a, b) => (b.pushedAt ?? '').localeCompare(a.pushedAt ?? '') || b.stars - a.stars,
    name: (a, b) => a.name.localeCompare(b.name),
  };
  return out.sort(by[sort]).slice(0, MAX_PROJECTS);
}

export function stackOf(projects: GithubRepoSummary[]): { lang: string; n: number; pct: number }[] {
  const counts = new Map<string, number>();
  for (const p of projects) counts.set(p.language ?? 'Other', (counts.get(p.language ?? 'Other') ?? 0) + 1);
  const total = Math.max(1, projects.length);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([lang, n]) => ({ lang, n, pct: Math.round((n / total) * 100) }));
}

export const floorCount = (n: number) => Math.max(1, Math.ceil(n / PER_FLOOR));

interface Slot {
  x: number;
  y: number; // floor level
  z: number;
  rot: number; // faces (sin rot, cos rot)
  floor: number;
}
const front = (s: Slot) => ({ x: Math.sin(s.rot), z: Math.cos(s.rot) });

/** 8 gardens per floor: four on each side wall, front to back. */
function layoutFor(n: number): Slot[] {
  const out: Slot[] = [];
  for (let i = 0; i < n; i++) {
    const floor = Math.floor(i / PER_FLOOR);
    const k = i % PER_FLOOR;
    const left = k % 2 === 0;
    out.push({ x: left ? -21 : 21, y: floor * FH, z: 18 - Math.floor(k / 2) * 11, rot: left ? Math.PI / 2 : -Math.PI / 2, floor });
  }
  return out;
}

/** Where the player stands (and which way the camera looks) to view a garden. */
export function viewPointFor(index: number, n: number): { x: number; y: number; z: number; yaw: number } {
  const s = layoutFor(n)[index];
  const f = front(s);
  return { x: s.x + f.x * 5.2, y: s.y + 1.7, z: s.z + f.z * 5.2, yaw: s.rot };
}

/* ------------------------------ stairs & floors ------------------------------ */
interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}
/** Floor plate at level j: solid, except an opening above the staircase that arrives from the floor below. */
function plateRects(j: number, floors: number): Rect[] {
  const full: Rect = { x0: -W / 2, x1: W / 2, z0: Z_BACK, z1: Z_FRONT };
  if (j >= floors) return [full]; // roof
  const even = (j - 1) % 2 === 0;
  const h: Rect = even ? { x0: -9.3, x1: -0.7, z0: -28, z1: -21 } : { x0: 0.7, x1: 9.3, z0: -15, z1: -8 };
  return [
    { x0: full.x0, x1: h.x0, z0: full.z0, z1: full.z1 },
    { x0: h.x1, x1: full.x1, z0: full.z0, z1: full.z1 },
    { x0: h.x0, x1: h.x1, z0: h.z1, z1: full.z1 },
    { x0: h.x0, x1: h.x1, z0: full.z0, z1: h.z0 },
  ].filter((r) => r.x1 - r.x0 > 0.01 && r.z1 - r.z0 > 0.01);
}

const RISE = FH / STEPS;
const RAMP_ANGLE = Math.atan2(FH, STAIR_RUN);
const RAMP_HALF = Math.hypot(FH, STAIR_RUN) / 2;

function flightGeom(k: number) {
  const even = k % 2 === 0;
  const dir = even ? -1 : 1; // z direction of travel
  return { even, dir, cx: even ? -5 : 5, zs: even ? -8 : -28, base: k * FH };
}

function Flight({ k }: { k: number }) {
  const { dir, cx, zs, base, even } = flightGeom(k);
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const o = new THREE.Object3D();
    const col = new THREE.Color();
    for (let i = 0; i < STEPS; i++) {
      const h = (i + 1) * RISE;
      o.position.set(cx, base + h / 2, zs + dir * (i + 0.5));
      o.scale.set(8, h, 1);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      m.setColorAt(i, col.set(i % 2 === 0 ? '#caa57a' : '#bd9a6e'));
    }
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [cx, dir, zs, base]);
  const zmid = zs + dir * (STAIR_RUN / 2);
  return (
    <group>
      <instancedMesh ref={ref} args={[undefined, undefined, STEPS]} castShadow receiveShadow frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial roughness={0.6} />
      </instancedMesh>
      {[-4.05, 4.05].map((dx) => (
        <mesh key={dx} position={[cx + dx, base + FH / 2 + 0.55, zmid]} rotation-x={even ? RAMP_ANGLE : -RAMP_ANGLE}>
          <boxGeometry args={[0.1, 0.12, RAMP_HALF * 2]} />
          <meshStandardMaterial color="#3b2a1f" roughness={0.5} />
        </mesh>
      ))}
      {/* wayfinding at the foot of the flight */}
      <Billboard position={[cx, base + 3.4, zs - dir * 1.5]}>
        <Text fontSize={0.55} color="#ffffff" outlineWidth={0.04} outlineColor="#0b1020" anchorX="center">
          {`UP  ▲  Floor ${k + 2}`}
        </Text>
      </Billboard>
    </group>
  );
}

/* ------------------------------ textures ------------------------------ */
let floorTex: THREE.CanvasTexture | null = null;
function parquet(): THREE.CanvasTexture {
  if (floorTex) return floorTex;
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d')!;
  const tones = ['#b98a5b', '#c4966a', '#ad7f52', '#bf9163'];
  const plankH = 64;
  for (let row = 0; row < 8; row++) {
    let x = -(row % 2) * 128;
    while (x < 512) {
      const len = 256;
      g.fillStyle = tones[Math.floor(rnd(row * 31 + x) * tones.length)];
      g.fillRect(x, row * plankH, len, plankH);
      g.strokeStyle = 'rgba(40,24,10,0.35)';
      g.lineWidth = 2;
      g.strokeRect(x + 1, row * plankH + 1, len - 2, plankH - 2);
      g.strokeStyle = 'rgba(60,36,16,0.12)';
      g.lineWidth = 1;
      for (let k = 0; k < 4; k++) {
        const yy = row * plankH + 10 + k * 14 + rnd(row + k + x) * 4;
        g.beginPath();
        g.moveTo(x + 4, yy);
        g.lineTo(x + len - 4, yy + (rnd(k + row) - 0.5) * 3);
        g.stroke();
      }
      x += len;
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(W / 8, (Z_FRONT - Z_BACK) / 8);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 16;
  floorTex = t;
  return t;
}

const setCursor = (c: string) => {
  document.body.style.cursor = c;
};

/* ------------------------------ repo exhibit ------------------------------ */
const LEAF_GREENS = ['#2f8f46', '#3da552', '#52b85f', '#2a7d3d', '#68c46a'];
const BLOOMS = ['#ffffff', '#ff7aa8', '#ffd54a', '#c58bff'];
const COLS = 14;
const ROWS = 8;

const fmtDate = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
};

function RepoGarden({ repo, slot, seed, delay }: { repo: GithubRepoSummary; slot: Slot; seed: number; delay: number }) {
  const root = useRef<THREE.Group>(null);
  const signRef = useRef<THREE.Group>(null);
  const rugMat = useRef<THREE.MeshBasicMaterial>(null);
  const stripMat = useRef<THREE.MeshStandardMaterial>(null);
  const monoMat = useRef<THREE.MeshStandardMaterial>(null);
  const monoRef = useRef<THREE.Group>(null);
  const leaves = useRef<THREE.InstancedMesh>(null);
  const blooms = useRef<THREE.InstancedMesh>(null);
  const stars = useRef<THREE.InstancedMesh>(null);
  // animation state lives in refs (never React state) so hovering costs no re-renders
  const anim = useRef({ grow: -delay * 2.4, hover: 0, hoverTarget: 0, selected: false });
  const accent = languageColor(repo.language);
  const bloomCount = Math.min(26, 7 + Math.min(repo.stars, 19));
  const starCount = Math.min(10, repo.stars);
  const initials = (repo.language ?? '?').replace(/[^A-Za-z+#]/g, '').slice(0, 2).toUpperCase() || '?';

  useEffect(() => {
    anim.current.selected = useWorld.getState().selected?.url === repo.url;
    return useWorld.subscribe((s) => {
      anim.current.selected = s.selected?.url === repo.url;
    });
  }, [repo.url]);

  useLayoutEffect(() => {
    const m = leaves.current;
    const b = blooms.current;
    if (!m || !b) return;
    const o = new THREE.Object3D();
    const col = new THREE.Color();
    let i = 0;
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        const k = seed * 1000 + r * 40 + c;
        o.position.set(-4 + c * 0.615 + (rnd(k) - 0.5) * 0.25, 1.15 + r * 0.72 + (rnd(k + 1) - 0.5) * 0.2, 0.05 + rnd(k + 2) * 0.2);
        o.rotation.set(rnd(k + 3) * 3, rnd(k + 4) * 3, 0);
        o.scale.setScalar(0.85 + rnd(k + 5) * 0.5);
        o.updateMatrix();
        m.setMatrixAt(i, o.matrix);
        m.setColorAt(i, col.set(LEAF_GREENS[Math.floor(rnd(k + 6) * LEAF_GREENS.length)]));
        i++;
      }
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    for (let n = 0; n < bloomCount; n++) {
      const k = seed * 500 + n * 7;
      o.position.set(-3.8 + (n / Math.max(1, bloomCount - 1)) * 7.6, 1.25 + rnd(k) * 0.25, 0.25 + rnd(k + 1) * 1.25);
      o.rotation.set(0, 0, 0);
      o.scale.setScalar(0.7 + rnd(k + 2) * 0.6);
      o.updateMatrix();
      b.setMatrixAt(n, o.matrix);
      b.setColorAt(n, col.set(n % 3 === 0 ? accent : BLOOMS[Math.floor(rnd(k + 3) * BLOOMS.length)]));
    }
    b.instanceMatrix.needsUpdate = true;
    if (b.instanceColor) b.instanceColor.needsUpdate = true;
  }, [seed, bloomCount, accent]);

  const placeStars = (t: number, lift: number) => {
    const m = stars.current;
    if (!m) return;
    const o = new THREE.Object3D();
    for (let i = 0; i < starCount; i++) {
      const u = starCount === 1 ? 0.5 : i / (starCount - 1);
      const ang = Math.PI * (0.15 + 0.7 * u);
      o.position.set(Math.cos(ang) * -3.0 * -1, 6.55 + Math.sin(ang) * 0.9 + Math.sin(t * 2 + i) * 0.06 * lift + lift * 0.2, 1.05);
      o.rotation.set(0, t * (1 + lift * 2) + i, 0);
      o.scale.setScalar(0.34 + lift * 0.1);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  };
  useLayoutEffect(() => placeStars(0, 0), [starCount]); // eslint-disable-line react-hooks/exhaustive-deps

  useFrame(({ clock }, dt) => {
    const a = anim.current;
    const g = root.current;
    if (!g) return;
    const hoverGoal = a.hoverTarget || (a.selected ? 0.6 : 0);
    const settled = a.grow >= 1 && Math.abs(a.hover - hoverGoal) < 0.002;
    if (settled) return;
    a.grow = Math.min(1, a.grow + dt * 2.2);
    a.hover += (hoverGoal - a.hover) * Math.min(1, dt * 10);
    const e = a.grow <= 0 ? 0.001 : 1 - Math.pow(1 - a.grow, 3);
    g.scale.set(1, Math.max(0.001, e), 1);
    g.visible = a.grow > 0;
    if (signRef.current) {
      const s = 1 + a.hover * 0.08;
      signRef.current.scale.set(s, s, 1);
      signRef.current.position.z = 0.95 + a.hover * 0.6;
    }
    if (rugMat.current) rugMat.current.opacity = 0.18 + a.hover * 0.3;
    if (stripMat.current) stripMat.current.emissiveIntensity = 1.4 + a.hover * 2.4;
    if (monoMat.current) monoMat.current.emissiveIntensity = 0.5 + a.hover * 1.2;
    if (monoRef.current) monoRef.current.position.y = 1.05 + 0.85 + Math.sin(clock.elapsedTime * 1.6) * 0.06 + a.hover * 0.25;
    placeStars(clock.elapsedTime, a.hover);
  });

  const desc = repo.description ? (repo.description.length > 120 ? `${repo.description.slice(0, 119)}…` : repo.description) : 'No description yet.';
  const name = repo.name.length > 22 ? `${repo.name.slice(0, 21)}…` : repo.name;
  const meta = [`★ ${repo.stars}`, repo.forks !== undefined ? `Forks ${repo.forks}` : '', fmtDate(repo.pushedAt) ? `Updated ${fmtDate(repo.pushedAt)}` : '']
    .filter(Boolean)
    .join('    ');
  const tags = (repo.topics ?? []).slice(0, 3).map((t) => `#${t}`).join('   ');

  return (
    <group ref={root} position={[slot.x, slot.y, slot.z]} rotation-y={slot.rot} scale={[1, 0.001, 1]} visible={false}>
      {/* invisible hit area: the only raycast target of this exhibit (R3F only tests objects that have handlers) */}
      <mesh
        position={[0, 3.9, 0.9]}
        onPointerOver={(e) => {
          e.stopPropagation();
          anim.current.hoverTarget = 1;
          setCursor('pointer');
        }}
        onPointerOut={() => {
          anim.current.hoverTarget = 0;
          setCursor('');
        }}
        onClick={(e) => {
          if (e.delta > 6) return; // it was a camera drag, not a click
          e.stopPropagation();
          useWorld.getState().setSelected(repo);
        }}
      >
        <boxGeometry args={[8.8, 7.8, 3]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {/* floor rug in the language colour */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.03, 3.6]}>
        <circleGeometry args={[3.4, 40]} />
        <meshBasicMaterial ref={rugMat} color={accent} transparent opacity={0.18} depthWrite={false} />
      </mesh>

      {/* backing frame + living hedge wall */}
      <RoundedBox args={[8.8, 7.8, 0.5]} radius={0.12} smoothness={3} position={[0, 3.9, -0.15]} castShadow receiveShadow>
        <meshStandardMaterial color="#3b2a1f" roughness={0.8} />
      </RoundedBox>
      <instancedMesh ref={leaves} args={[undefined, undefined, COLS * ROWS]} castShadow frustumCulled={false}>
        <icosahedronGeometry args={[0.42, 1]} />
        <meshStandardMaterial roughness={0.95} flatShading />
      </instancedMesh>

      {/* planter + flowers + topic tags */}
      <RoundedBox args={[8.8, 1, 1.9]} radius={0.1} smoothness={3} position={[0, 0.5, 0.75]} castShadow receiveShadow>
        <meshStandardMaterial color="#8a5a33" roughness={0.7} />
      </RoundedBox>
      <mesh position={[0, 1.02, 0.75]}>
        <boxGeometry args={[8.4, 0.08, 1.5]} />
        <meshStandardMaterial color="#3a2a1c" roughness={1} />
      </mesh>
      <instancedMesh ref={blooms} args={[undefined, undefined, bloomCount]} frustumCulled={false}>
        <sphereGeometry args={[0.2, 14, 10]} />
        <meshStandardMaterial roughness={0.5} />
      </instancedMesh>
      {tags && (
        <Text position={[0, 0.5, 1.72]} fontSize={0.3} color="#f3dfc4" anchorX="center" anchorY="middle" maxWidth={8}>
          {tags}
        </Text>
      )}

      {/* language monolith */}
      <group ref={monoRef} position={[-3.3, 1.9, 0.85]}>
        <RoundedBox args={[0.9, 0.9, 0.9]} radius={0.12} smoothness={3} castShadow>
          <meshStandardMaterial ref={monoMat} color={accent} emissive={accent} emissiveIntensity={0.5} roughness={0.3} metalness={0.2} />
        </RoundedBox>
        <Text position={[0, 0, 0.47]} fontSize={0.38} color="#ffffff" outlineWidth={0.02} outlineColor="#0b1020" anchorX="center" anchorY="middle">
          {initials}
        </Text>
      </group>

      {/* star arc: one star per GitHub star (max 10) */}
      {starCount > 0 && (
        <instancedMesh ref={stars} args={[undefined, undefined, starCount]} frustumCulled={false}>
          <octahedronGeometry args={[1, 0]} />
          <meshStandardMaterial color="#ffd54a" emissive="#ffb300" emissiveIntensity={1.8} flatShading />
        </instancedMesh>
      )}

      {/* sign */}
      <group ref={signRef} position={[0, 4.0, 0.95]}>
        <RoundedBox args={[6.8, 3.0, 0.2]} radius={0.1} smoothness={3} castShadow>
          <meshStandardMaterial color="#10162b" roughness={0.5} />
        </RoundedBox>
        <mesh position={[0, 1.45, 0.12]}>
          <boxGeometry args={[6.8, 0.1, 0.06]} />
          <meshStandardMaterial ref={stripMat} color={accent} emissive={accent} emissiveIntensity={1.4} />
        </mesh>
        <Text position={[-3.2, 1.0, 0.13]} fontSize={0.26} color={accent} anchorX="left" anchorY="middle">
          {(repo.language ?? 'No language').toUpperCase()}
        </Text>
        <Text position={[-3.2, 0.35, 0.13]} fontSize={0.55} color="#ffffff" anchorX="left" anchorY="middle" maxWidth={6.4}>
          {name}
        </Text>
        <Text position={[-3.2, -0.2, 0.13]} fontSize={0.27} color="#b8c2e0" anchorX="left" anchorY="top" maxWidth={6.4} lineHeight={1.3}>
          {desc}
        </Text>
        <Text position={[-3.2, -1.2, 0.13]} fontSize={0.27} color="#f1e05a" anchorX="left" anchorY="middle">
          {meta}
        </Text>
      </group>

      {/* hanging lamp bar */}
      <mesh position={[0, 7.3, 1.1]}>
        <boxGeometry args={[5, 0.12, 0.3]} />
        <meshStandardMaterial color="#fff4d6" emissive="#ffe3a3" emissiveIntensity={2} />
      </mesh>
    </group>
  );
}

/* ------------------------------ tech-stack tower ------------------------------ */
function Segment({ lang, y, h, active, dim }: { lang: string; y: number; h: number; active: boolean; dim: boolean }) {
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  const hover = useRef(0);
  const c = languageColor(lang);
  useFrame((_, dt) => {
    if (!mat.current) return;
    const goal = active ? 1.2 : dim ? 0.02 : 0.35 + hover.current * 0.9;
    mat.current.emissiveIntensity += (goal - mat.current.emissiveIntensity) * Math.min(1, dt * 8);
  });
  return (
    <mesh
      position={[0, y, 0]}
      castShadow
      onPointerOver={(e) => {
        e.stopPropagation();
        hover.current = 1;
        setCursor('pointer');
      }}
      onPointerOut={() => {
        hover.current = 0;
        setCursor('');
      }}
      onClick={(e) => {
        if (e.delta > 6) return;
        e.stopPropagation();
        const st = useWorld.getState();
        st.setLang(st.lang === lang ? null : lang);
      }}
    >
      <cylinderGeometry args={[1.05, 1.05, h - 0.06, 40]} />
      <meshStandardMaterial ref={mat} color={c} emissive={c} emissiveIntensity={0.35} roughness={0.3} metalness={0.25} transparent opacity={dim ? 0.45 : 1} />
    </mesh>
  );
}

function TechStack({ projects, accent, lang }: { projects: GithubRepoSummary[]; accent: string; lang: string | null }) {
  const spin = useRef<THREE.Group>(null);
  const stack = useMemo(() => stackOf(projects), [projects]);
  const TOTAL = 6.4;
  useFrame((_, dt) => {
    if (spin.current) spin.current.rotation.y += dt * 0.35;
  });
  const segs = useMemo(() => {
    const sum = stack.reduce((a, s) => a + s.n, 0) || 1;
    let y = 0.5;
    return stack.map((s) => {
      const h = Math.max(0.55, (s.n / sum) * TOTAL);
      const seg = { ...s, y: y + h / 2, h };
      y += h;
      return seg;
    });
  }, [stack]);
  const top = segs.length ? segs[segs.length - 1].y + segs[segs.length - 1].h / 2 : 1;
  return (
    <group position={[0, 0, TOWER_Z]}>
      <mesh position={[0, 0.25, 0]} receiveShadow castShadow>
        <cylinderGeometry args={[3, 3.2, 0.5, 48]} />
        <meshStandardMaterial color="#232a45" roughness={0.35} metalness={0.3} />
      </mesh>
      <mesh position={[0, 0.52, 0]} rotation-x={Math.PI / 2}>
        <torusGeometry args={[2.75, 0.07, 12, 64]} />
        <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={2} />
      </mesh>
      <group ref={spin}>
        {segs.map((s) => (
          <Segment key={s.lang} lang={s.lang} y={s.y} h={s.h} active={lang === s.lang} dim={lang !== null && lang !== s.lang} />
        ))}
        <mesh position={[0, top + 0.5, 0]} castShadow>
          <octahedronGeometry args={[0.55, 0]} />
          <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={1.6} flatShading />
        </mesh>
      </group>
      {segs.map((s, i) => {
        const right = i % 2 === 0;
        return (
          <Billboard key={s.lang} position={[right ? 2.2 : -2.2, s.y, 0]}>
            <Text
              fontSize={0.42}
              color={lang === s.lang ? '#ffffff' : '#dfe6ff'}
              anchorX={right ? 'left' : 'right'}
              anchorY="middle"
              outlineWidth={0.03}
              outlineColor="#0b1020"
            >
              {`${s.lang}  ${s.pct}% · ${s.n}`}
            </Text>
          </Billboard>
        );
      })}
      <Billboard position={[0, top + 2, 0]}>
        <Text fontSize={0.7} color="#ffffff" outlineWidth={0.05} outlineColor="#0b1020" anchorX="center">
          TECH STACK
        </Text>
        <Text position={[0, -0.6, 0]} fontSize={0.28} color="#b8c2e0" anchorX="center">
          click a layer to filter the projects
        </Text>
      </Billboard>
      {segs.length === 0 && (
        <Billboard position={[0, 3, 0]}>
          <Text fontSize={0.4} color="#b8c2e0">
            No public languages yet
          </Text>
        </Billboard>
      )}
    </group>
  );
}

/* ------------------------------ the house ------------------------------ */
export function Interior({
  building,
  projects,
  player,
}: {
  building: CityBuilding;
  projects: GithubRepoSummary[];
  player: { x: number; y: number; z: number };
}) {
  const theme = THEMES[building.theme] ?? THEMES.mixed;
  const accent = theme.primary;
  const lang = useWorld((s) => s.lang);
  const q = useWorld((s) => s.q);
  const sort = useWorld((s) => s.sort);
  const jumpTo = useWorld((s) => s.jumpTo);

  const view = useMemo(() => filterRepos(projects, lang, q, sort), [projects, lang, q, sort]);
  const slots = useMemo(() => layoutFor(view.length), [view.length]);
  const floors = floorCount(view.length);
  const Htot = floors * FH;
  const D = Z_FRONT - Z_BACK;
  const zc = (Z_FRONT + Z_BACK) / 2;
  const floorTexture = useMemo(() => parquet(), []);
  const last = useRef('');
  const lights = useRef<(THREE.PointLight | null)[]>([]);
  const totalStars = useMemo(() => projects.reduce((a, r) => a + r.stars, 0), [projects]);
  const plates = useMemo(() => Array.from({ length: floors }, (_, j) => ({ j: j + 1, rects: plateRects(j + 1, floors) })), [floors]);

  // HUD asked to visit a repo: compute where its garden is and hand the player controller a warp
  useEffect(() => {
    if (!jumpTo) return;
    const i = view.findIndex((r) => r.url === jumpTo);
    if (i >= 0) {
      const st = useWorld.getState();
      st.setSelected(view[i]);
      st.setWarp(viewPointFor(i, view.length));
    }
    useWorld.getState().jumpToRepo(null);
  }, [jumpTo, view]);

  // a filter removed the floor the player stands on: put them back at the entrance
  useEffect(() => {
    if (useWorld.getState().floor >= floors) useWorld.getState().setWarp({ x: 0, y: 1.7, z: 22, yaw: 0 });
  }, [floors]);

  useFrame(() => {
    const localY = player.y - INTERIOR_Y;
    const floor = clamp(Math.floor((localY + 0.2) / FH), 0, floors - 1);
    if (floor !== useWorld.getState().floor) useWorld.getState().setFloor(floor);

    // proximity focus (only exhibits on the player's floor)
    let best: InteriorFocus = null;
    let bestD = 4.4;
    if (floor === 0) {
      const dDoor = Math.hypot(player.x, player.z - DOOR_Z);
      if (dDoor < 4.4) {
        best = { kind: 'door' };
        bestD = dDoor;
      }
    }
    view.forEach((repo, i) => {
      const s = slots[i];
      if (s.floor !== floor) return;
      const f = front(s);
      const d = Math.hypot(player.x - (s.x + f.x * 3.6), player.z - (s.z + f.z * 3.6));
      if (d < bestD) {
        bestD = d;
        best = { kind: 'repo', repo };
      }
    });
    if (!best && floor === 0 && Math.hypot(player.x, player.z - TOWER_Z) < 6.5) best = { kind: 'stack' };
    const found = best as InteriorFocus;
    const key = found ? found.kind + (found.kind === 'repo' ? found.repo.url : '') : '';
    if (key !== last.current) {
      last.current = key;
      useWorld.getState().setFocus(found);
    }
    // a few lights follow the player (many static point lights would be too expensive)
    const lz = clamp(player.z, Z_BACK + 8, Z_FRONT - 8);
    lights.current.forEach((l, i) => {
      if (l) l.position.set(i % 2 === 0 ? -12 : 12, floor * FH + 7.5, lz + (i < 2 ? -8 : 8));
    });
  });

  return (
    <group position={[0, INTERIOR_Y, 0]}>
      {/* physics */}
      <RigidBody type="fixed" colliders={false} key={`${view.length}`}>
        <CuboidCollider args={[W / 2 + 1, 0.5, D / 2 + 1]} position={[0, -0.5, zc]} />
        <CuboidCollider args={[0.5, Htot / 2, D / 2]} position={[-W / 2 - 0.5, Htot / 2, zc]} />
        <CuboidCollider args={[0.5, Htot / 2, D / 2]} position={[W / 2 + 0.5, Htot / 2, zc]} />
        <CuboidCollider args={[W / 2, Htot / 2, 0.5]} position={[0, Htot / 2, Z_BACK - 0.5]} />
        <CuboidCollider args={[W / 2, Htot / 2, 0.5]} position={[0, Htot / 2, Z_FRONT + 0.5]} />
        <CuboidCollider args={[3.1, 0.5, 3.1]} position={[0, 0.5, TOWER_Z]} />
        {plates.flatMap(({ j, rects }) =>
          rects.map((r, i) => (
            <CuboidCollider
              key={`${j}-${i}`}
              args={[(r.x1 - r.x0) / 2, 0.25, (r.z1 - r.z0) / 2]}
              position={[(r.x0 + r.x1) / 2, j * FH - 0.25, (r.z0 + r.z1) / 2]}
            />
          )),
        )}
        {Array.from({ length: floors - 1 }, (_, k) => {
          const { even, cx, zs, dir, base } = flightGeom(k);
          return (
            <CuboidCollider
              key={`ramp${k}`}
              args={[4, 0.15, RAMP_HALF]}
              position={[cx, base + FH / 2 - 0.17, zs + dir * (STAIR_RUN / 2)]}
              rotation={[even ? RAMP_ANGLE : -RAMP_ANGLE, 0, 0]}
            />
          );
        })}
        {slots.map((s, i) => {
          const f = front(s);
          return <CuboidCollider key={`g${i}`} args={[1, 0.6, 4.4]} position={[s.x + f.x * 0.85, s.y + 0.6, s.z + f.z * 0.85]} />;
        })}
      </RigidBody>

      {/* shell: ground floor, plates, walls */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0, zc]} receiveShadow>
        <planeGeometry args={[W, D]} />
        <meshStandardMaterial map={floorTexture} roughness={0.35} metalness={0.05} />
      </mesh>
      {plates.flatMap(({ j, rects }) =>
        rects.map((r, i) => (
          <mesh key={`${j}-${i}`} position={[(r.x0 + r.x1) / 2, j * FH - 0.25, (r.z0 + r.z1) / 2]} receiveShadow castShadow>
            <boxGeometry args={[r.x1 - r.x0, 0.5, r.z1 - r.z0]} />
            <meshStandardMaterial color={j === floors ? '#f6f1e7' : '#b98a5b'} roughness={j === floors ? 0.9 : 0.4} />
          </mesh>
        )),
      )}
      {[
        { p: [0, Htot / 2, Z_BACK] as const, s: [W, Htot, 0.3] as const },
        { p: [0, Htot / 2, Z_FRONT] as const, s: [W, Htot, 0.3] as const },
        { p: [-W / 2, Htot / 2, zc] as const, s: [0.3, Htot, D] as const },
        { p: [W / 2, Htot / 2, zc] as const, s: [0.3, Htot, D] as const },
      ].map((w, i) => (
        <mesh key={i} position={[...w.p]} receiveShadow>
          <boxGeometry args={[...w.s]} />
          <meshStandardMaterial color="#efe6d6" roughness={0.9} />
        </mesh>
      ))}
      {/* skirting + ceiling light strips on every floor */}
      {Array.from({ length: floors }, (_, j) => (
        <group key={j} position={[0, j * FH, 0]}>
          {[
            { p: [0, 0.25, Z_BACK + 0.2] as const, s: [W, 0.5, 0.15] as const },
            { p: [0, 0.25, Z_FRONT - 0.2] as const, s: [W, 0.5, 0.15] as const },
            { p: [-W / 2 + 0.2, 0.25, zc] as const, s: [0.15, 0.5, D] as const },
            { p: [W / 2 - 0.2, 0.25, zc] as const, s: [0.15, 0.5, D] as const },
          ].map((w, i) => (
            <mesh key={i} position={[...w.p]}>
              <boxGeometry args={[...w.s]} />
              <meshStandardMaterial color="#5a3b24" roughness={0.6} />
            </mesh>
          ))}
          {[-15, 15].map((x) => (
            <mesh key={x} position={[x, FH - 0.62, zc]}>
              <boxGeometry args={[1.2, 0.1, D - 6]} />
              <meshStandardMaterial color="#fff6e0" emissive="#fff0cc" emissiveIntensity={1.8} />
            </mesh>
          ))}
          {j > 0 && (
            <Text position={[0, 7.2, Z_BACK + 0.3]} fontSize={1.5} color="#6b6455" anchorX="center" anchorY="middle">
              {`FLOOR ${j + 1}`}
            </Text>
          )}
          {j > 0 && (
            <Text position={[0, 5.6, Z_BACK + 0.3]} fontSize={0.6} color={accent} anchorX="center" anchorY="middle">
              {`projects ${j * PER_FLOOR + 1}–${Math.min(view.length, (j + 1) * PER_FLOOR)}`}
            </Text>
          )}
        </group>
      ))}

      {/* stairs */}
      {Array.from({ length: floors - 1 }, (_, k) => (
        <Flight key={k} k={k} />
      ))}

      {/* lobby rug in the owner's colour */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.02, TOWER_Z]}>
        <circleGeometry args={[7, 64]} />
        <meshStandardMaterial color={accent} roughness={0.95} transparent opacity={0.28} />
      </mesh>

      <TechStack projects={projects} accent={accent} lang={lang} />

      {view.map((r, i) => (
        <RepoGarden key={r.url} repo={r} slot={slots[i]} seed={i + 1} delay={(i % PER_FLOOR) * 0.04 + slots[i].floor * 0.1} />
      ))}

      {view.length === 0 && (
        <Billboard position={[0, 5, Z_BACK + 8]}>
          <Text fontSize={0.9} color="#6b6455">
            {projects.length === 0 ? 'No public repositories to show yet' : 'No projects match this filter'}
          </Text>
        </Billboard>
      )}

      {/* ground-floor back wall banner */}
      <group position={[0, 0, Z_BACK + 0.3]}>
        <Text position={[0, 7, 0]} fontSize={2.2} color="#ffffff" outlineWidth={0.1} outlineColor="#0b1020" anchorX="center">
          {`@${building.ownerUsername}`}
        </Text>
        <Text position={[0, 4.9, 0]} fontSize={0.9} color={accent} outlineWidth={0.05} outlineColor="#0b1020" anchorX="center">
          {theme.label}
        </Text>
        <Text position={[0, 3.5, 0]} fontSize={0.6} color="#6b6455" anchorX="center">
          {`${projects.length} ${projects.length === 1 ? 'project' : 'projects'} · ★ ${totalStars}${floors > 1 ? ` · ${floors} floors` : ''}`}
        </Text>
      </group>

      {/* exit door */}
      <group position={[0, 0, Z_FRONT - 0.2]}>
        <mesh position={[0, 2.2, 0]}>
          <boxGeometry args={[4.4, 4.4, 0.1]} />
          <meshStandardMaterial color="#3a2a22" roughness={0.6} />
        </mesh>
        <mesh position={[0, 4.9, -0.05]}>
          <boxGeometry args={[3.6, 0.8, 0.12]} />
          <meshStandardMaterial color="#0f3d22" emissive="#2dd36f" emissiveIntensity={1.3} />
        </mesh>
        <Text position={[0, 4.9, -0.14]} rotation-y={Math.PI} fontSize={0.5} color="#ffffff" anchorX="center" anchorY="middle">
          EXIT
        </Text>
        <mesh position={[1.4, 2.1, -0.1]}>
          <sphereGeometry args={[0.13, 16, 12]} />
          <meshStandardMaterial color="#e6c15a" metalness={0.8} roughness={0.25} />
        </mesh>
      </group>

      {/* lights: bright ambient + 4 point lights that follow the player */}
      <ambientLight intensity={0.75} color="#fff1dc" />
      <hemisphereLight args={['#fff7ea', '#8a6a4a', 0.6]} />
      {[0, 1, 2, 3].map((i) => (
        <pointLight
          key={i}
          ref={(l) => {
            lights.current[i] = l;
          }}
          position={[i % 2 === 0 ? -12 : 12, 7.5, i < 2 ? 10 : 24]}
          intensity={130}
          distance={36}
          decay={2}
          color="#ffe9c4"
        />
      ))}
    </group>
  );
}

const clamp = THREE.MathUtils.clamp;
