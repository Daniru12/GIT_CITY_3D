// Deterministic procedural city. Shared by the API (plot allocation) and the web client (rendering).
// Every block derives its content from (seed, bx, bz) only, so growing the city NEVER moves existing plots.
export const BLOCK = 30; // buildable block size
export const ROAD = 8; // road width
export const PITCH = BLOCK + ROAD;
export const MAX_RADIUS = 8; // hard cap on city growth (blocks from the centre)
export const SLAB = 0.15; // sidewalk slab height
export const CITY_SEED = 1337;
export const GROWTH_THRESHOLD = 0.6; // unlock the next ring when this share of slots is claimed

export type RoofKind = 'flat' | 'hip' | 'green';

export interface PlotInfo {
  id: string; // stable slot key "bx:bz:idx"
  bx: number;
  bz: number;
  ring: number;
  x: number;
  z: number;
  size: number;
  height: number;
  color: string;
  roof: RoofKind;
  roofColor: string;
  tex: number;
  name: string;
}
export interface Point {
  x: number;
  z: number;
  s: number;
}
export interface Mark {
  x: number;
  z: number;
  w: number;
  d: number;
}
export interface CarSpec {
  axis: 'x' | 'z';
  road: number;
  lane: number;
  dir: 1 | -1;
  phase: number;
  speed: number;
  kind: 'car' | 'truck' | 'bus';
  color: string;
}
export interface City {
  radius: number;
  plots: PlotInfo[];
  blocks: { x: number; z: number }[];
  trees: Point[];
  lamps: Point[];
  roads: { x: number; z: number; w: number; d: number }[];
  roadLines: number[];
  dashes: Mark[];
  crosswalks: Mark[];
  cars: CarSpec[];
  gems: { x: number; z: number }[];
  extent: number;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const blockRng = (seed: number, bx: number, bz: number) =>
  mulberry32((seed ^ Math.imul(bx + 1000, 73856093) ^ Math.imul(bz + 1000, 19349663)) >>> 0);

// brick palette: red, blue, yellow, green, white, grey, orange
const WALLS = ['#c91a09', '#0055bf', '#f2cd37', '#237841', '#f2f3f2', '#a0a5a9', '#fe8a18', '#0055bf', '#f2cd37', '#c91a09'];
const HIP_ROOFS = ['#b5532f', '#a4452a', '#c2613a', '#8e3b27'];
const CAR_COLORS = ['#e04b3a', '#f2c230', '#3a7bd5', '#f4f4f0', '#2d2f3a', '#4bb36b', '#ff8a3d'];

export function generateCity(seed = CITY_SEED, radius = 1): City {
  const r = Math.max(0, Math.min(MAX_RADIUS, radius));
  const plots: PlotInfo[] = [];
  const blocks: City['blocks'] = [];
  const trees: Point[] = [];
  const lamps: Point[] = [];
  const offsets = [-7.5, 7.5];
  const extent = (2 * r + 1) * PITCH;
  const roadLines: number[] = [];
  for (let i = -r; i <= r + 1; i++) roadLines.push((i - 0.5) * PITCH);

  for (let bx = -r; bx <= r; bx++) {
    for (let bz = -r; bz <= r; bz++) {
      const rand = blockRng(seed, bx, bz);
      const cx = bx * PITCH;
      const cz = bz * PITCH;
      const plaza = bx === 0 && bz === 0;
      const ring = Math.max(Math.abs(bx), Math.abs(bz));
      blocks.push({ x: cx, z: cz });

      for (const sx of [-1, 1])
        for (const sz of [-1, 1]) lamps.push({ x: cx + sx * (BLOCK / 2 + 0.6), z: cz + sz * (BLOCK / 2 + 0.6), s: 1 });
      for (const t of [-11.25, -3.75, 3.75, 11.25]) {
        for (const e of [-1, 1]) {
          trees.push({ x: cx + e * 14.3, z: cz + t, s: 0.9 + rand() * 0.3 });
          trees.push({ x: cx + t, z: cz + e * 14.3, s: 0.9 + rand() * 0.3 });
        }
      }
      if (plaza) {
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          trees.push({ x: cx + Math.cos(a) * 10, z: cz + Math.sin(a) * 10, s: 1.2 + rand() * 0.3 });
        }
        continue;
      }

      let idx = 0;
      for (const ox of offsets) {
        for (const oz of offsets) {
          const x = cx + ox;
          const z = cz + oz;
          const id = `${bx}:${bz}:${idx++}`;
          if (rand() < 0.16) {
            // park: not claimable
            const n = 2 + Math.floor(rand() * 3);
            for (let i = 0; i < n; i++)
              trees.push({ x: x + (rand() - 0.5) * 8, z: z + (rand() - 0.5) * 8, s: 0.8 + rand() * 0.6 });
            continue;
          }
          const floors = 2 + Math.floor(rand() * 3) + Math.floor(Math.max(0, 6 - ring) * rand() * 2.6); // tall downtown tapering to low-rise edges (same rand() call order, so slot ids are unchanged)
          const height = floors * 3;
          const roll = rand();
          const roof: RoofKind = height <= 9 && roll < 0.7 ? 'hip' : roll < 0.3 ? 'green' : 'flat';
          plots.push({
            id,
            bx,
            bz,
            ring,
            x,
            z,
            size: 8 + Math.floor(rand() * 3),
            height,
            color: WALLS[Math.floor(rand() * WALLS.length)],
            roof,
            roofColor: HIP_ROOFS[Math.floor(rand() * HIP_ROOFS.length)],
            tex: Math.floor(rand() * 3),
            name: `Plot ${id}`,
          });
        }
      }
    }
  }

  const roads: City['roads'] = [];
  for (const p of roadLines) {
    roads.push({ x: p, z: 0, w: ROAD, d: extent + ROAD });
    roads.push({ x: 0, z: p, w: extent + ROAD, d: ROAD });
  }

  const dashes: Mark[] = [];
  const crosswalks: Mark[] = [];
  const half = extent / 2 + ROAD / 2;
  for (const p of roadLines) {
    for (let t = -half + 2; t < half; t += 4) {
      if (roadLines.some((q) => Math.abs(q - t) < 8)) continue;
      dashes.push({ x: p, z: t, w: 0.3, d: 2 });
      dashes.push({ x: t, z: p, w: 2, d: 0.3 });
    }
  }
  for (const a of roadLines)
    for (const b of roadLines)
      for (const sgn of [-1, 1])
        for (let k = 0; k < 6; k++) {
          const o = (k - 2.5) * 1.0;
          crosswalks.push({ x: a + o, z: b + sgn * 6, w: 0.55, d: 2.6 });
          crosswalks.push({ x: a + sgn * 6, z: b + o, w: 2.6, d: 0.55 });
        }

  const rand = mulberry32(seed + r);
  const cars: CarSpec[] = [];
  (['z', 'x'] as const).forEach((axis) => {
    roadLines.forEach((_, road) => {
      for (const dir of [1, -1] as const)
        for (let n = 0; n < 2; n++)
          cars.push({
            axis,
            road,
            lane: (axis === 'z' ? -2 : 2) * dir,
            dir,
            phase: rand(),
            speed: 6 + rand() * 5,
            kind: ((k) => (k < 0.1 ? 'bus' : k < 0.3 ? 'truck' : 'car'))(rand()),
            color: CAR_COLORS[Math.floor(rand() * CAR_COLORS.length)],
          });
    });
  });

  const gems: City['gems'] = [];
  for (let i = 0; i < 48; i++) {
    const p = roadLines[Math.floor(rand() * roadLines.length)];
    const along = (rand() - 0.5) * (extent - 10);
    const lateral = (rand() - 0.5) * 4.8;
    gems.push(i % 2 === 0 ? { x: p + lateral, z: along } : { x: along, z: p + lateral });
  }

  return { radius: r, plots, blocks, trees, lamps, roads, roadLines, dashes, crosswalks, cars, gems, extent };
}

/* ---------------- growth rules (used by the server to allocate plots) ---------------- */

let slotCache: PlotInfo[] | null = null;
/** Every claimable slot the city can ever have, ordered centre-outwards (ring, then angle). Deterministic. */
export function orderedSlots(): PlotInfo[] {
  if (!slotCache) {
    slotCache = generateCity(CITY_SEED, MAX_RADIUS).plots.sort(
      (a, b) =>
        a.ring - b.ring ||
        Math.atan2(a.z, a.x) - Math.atan2(b.z, b.x) ||
        a.id.localeCompare(b.id),
    );
  }
  return slotCache;
}

export function slotsWithin(radius: number): number {
  return orderedSlots().filter((s) => s.ring <= radius).length;
}

/** How many rings are unlocked given the number of claimed plots. */
export function radiusFor(occupied: number): number {
  for (let r = 1; r < MAX_RADIUS; r++) if (occupied < slotsWithin(r) * GROWTH_THRESHOLD) return r;
  return MAX_RADIUS;
}

/** The slot the next new developer receives: first free slot (centre-outwards) in the unlocked area. */
export function nextSlot(taken: ReadonlySet<string>): PlotInfo | null {
  const r = radiusFor(taken.size);
  return orderedSlots().find((s) => s.ring <= r && !taken.has(s.id)) ?? null;
}

/* ---------------- GitHub-based building themes ---------------- */
export interface Theme {
  id: string;
  label: string;
  primary: string;
  secondary: string;
}
export const THEMES: Record<string, Theme> = {
  javascript: { id: 'javascript', label: 'JavaScript Tower', primary: '#f7df1e', secondary: '#323330' },
  python: { id: 'python', label: 'Python Studio', primary: '#3776ab', secondary: '#ffd43b' },
  java: { id: 'java', label: 'Java Coffee Office', primary: '#d2691e', secondary: '#f8f0e3' },
  go: { id: 'go', label: 'Go Laboratory', primary: '#00add8', secondary: '#e0ebf5' },
  cpp: { id: 'cpp', label: 'C++ Workshop', primary: '#7a8793', secondary: '#f5a623' },
  rust: { id: 'rust', label: 'Rust Foundry', primary: '#b7410e', secondary: '#f2d0b0' },
  mixed: { id: 'mixed', label: 'Polyglot Tower', primary: '#7c5cff', secondary: '#00d4ff' },
};
const LANG_TO_THEME: Record<string, string> = {
  JavaScript: 'javascript',
  TypeScript: 'javascript',
  Python: 'python',
  Java: 'java',
  Kotlin: 'java',
  Go: 'go',
  'C++': 'cpp',
  C: 'cpp',
  Rust: 'rust',
};
/** Theme from public language counts; purely cosmetic (never depends on repo count or activity volume). */
export function themeFromLanguages(languages: Record<string, number>): string {
  const byTheme: Record<string, number> = {};
  let total = 0;
  for (const [lang, n] of Object.entries(languages)) {
    total += n;
    const t = LANG_TO_THEME[lang];
    if (t) byTheme[t] = (byTheme[t] ?? 0) + n;
  }
  const top = Object.entries(byTheme).sort((a, b) => b[1] - a[1])[0];
  return top && top[1] / Math.max(1, total) >= 0.4 ? top[0] : 'mixed';
}

/* ---------------- API payload ---------------- */
export interface CityBuilding {
  id: string;
  slot: string;
  name: string;
  theme: string;
  ownerUsername: string;
  ownerAvatarUrl: string | null;
  /** The developer's top public repositories (public GitHub data, captured at sign-in). */
  projects: GithubRepoSummary[];
  createdAt: string;
}
export interface CitySnapshot {
  seed: number;
  radius: number;
  developers: number;
  buildings: CityBuilding[];
}

/* ---------------- GitHub stats (public data only, fetched at sign-in) ---------------- */
export interface GithubRepoSummary {
  name: string;
  description: string | null;
  language: string | null;
  stars: number;
  url: string;
  forks?: number;
  topics?: string[];
  /** ISO date of the last push (public data). */
  pushedAt?: string | null;
}
export interface GithubStats {
  publicRepos: number;
  followers: number;
  stars: number; // total stars across own public, non-fork repos
  commits: number; // public commit contributions, last 12 months
  pullRequests: number;
  issues: number;
  reviews: number;
  totalContributions: number;
  languages: Record<string, number>;
  topRepos: GithubRepoSummary[];
  /** Every public non-fork repo (capped), most-starred first. Older accounts only have topRepos until they sign in again. */
  repos?: GithubRepoSummary[];
  syncedAt: string;
}

/** GitHub-style language colours for project signs (cosmetic). */
const LANGUAGE_COLORS: Record<string, string> = {
  JavaScript: '#f1e05a',
  TypeScript: '#3178c6',
  Python: '#3572a5',
  Java: '#b07219',
  Go: '#00add8',
  Rust: '#dea584',
  'C++': '#f34b7d',
  C: '#8a8a8a',
  'C#': '#178600',
  HTML: '#e34c26',
  CSS: '#563d7c',
  Shell: '#89e051',
  Kotlin: '#a97bff',
  Swift: '#f05138',
  PHP: '#4f5d95',
  Ruby: '#701516',
};
export const languageColor = (lang: string | null | undefined): string => (lang && LANGUAGE_COLORS[lang]) || '#8b949e';
