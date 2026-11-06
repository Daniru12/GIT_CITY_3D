import { create } from 'zustand';
import type { CityBuilding, GithubRepoSummary } from '@gitcity/shared';
import type { PlotInfo } from './layout';

/** What the player is standing next to inside a building. */
export type RepoSort = 'stars' | 'recent' | 'name';

export type InteriorFocus = { kind: 'door' } | { kind: 'repo'; repo: GithubRepoSummary } | { kind: 'stack' } | null;

interface WorldState {
  nearby: PlotInfo | null;
  panel: PlotInfo | null;
  lowGfx: boolean;
  cityView: boolean;
  score: number;
  night: boolean;
  welcome: boolean;
  emote: string;
  /** Building the player is currently inside (null = walking in the city). */
  interior: CityBuilding | null;
  /** Where to put the player back on the street when leaving. */
  exitPos: [number, number, number];
  focus: InteriorFocus;
  /** Project the player clicked / picked in the list (detail card). */
  selected: GithubRepoSummary | null;
  /** Interior filters shared by the 3D hall and the HUD list. */
  lang: string | null;
  q: string;
  sort: RepoSort;
  /** Request: walk the player to this repo's garden (consumed by the interior). */
  jumpTo: string | null;
  /** Teleport request consumed by the player controller. */
  warp: { x: number; y: number; z: number; yaw: number } | null;
  /** Floor of the building the player is currently on (0 = ground). */
  floor: number;
  setFloor: (f: number) => void;
  setSelected: (r: GithubRepoSummary | null) => void;
  setLang: (l: string | null) => void;
  setQuery: (q: string) => void;
  setSort: (s: RepoSort) => void;
  jumpToRepo: (url: string | null) => void;
  setWarp: (w: { x: number; y: number; z: number; yaw: number } | null) => void;
  setNearby: (p: PlotInfo | null) => void;
  setPanel: (p: PlotInfo | null) => void;
  toggleLowGfx: () => void;
  toggleCityView: () => void;
  addScore: (n: number) => void;
  toggleNight: () => void;
  setWelcome: (w: boolean) => void;
  setEmote: (e: string) => void;
  enterInterior: (b: CityBuilding, exitPos: [number, number, number]) => void;
  exitInterior: () => void;
  setFocus: (f: InteriorFocus) => void;
}

export const useWorld = create<WorldState>((set) => ({
  nearby: null,
  panel: null,
  lowGfx: false,
  cityView: false,
  score: 0,
  night: false,
  welcome: false,
  emote: 'none',
  interior: null,
  exitPos: [0, 3, 14],
  focus: null,
  selected: null,
  lang: null,
  q: '',
  sort: 'stars',
  jumpTo: null,
  warp: null,
  floor: 0,
  setFloor: (floor) => set({ floor }),
  setSelected: (selected) => set({ selected }),
  setLang: (lang) => set({ lang }),
  setQuery: (q) => set({ q }),
  setSort: (sort) => set({ sort }),
  jumpToRepo: (jumpTo) => set({ jumpTo }),
  setWarp: (warp) => set({ warp }),
  setNearby: (nearby) => set({ nearby }),
  setPanel: (panel) => set({ panel }),
  toggleLowGfx: () => set((s) => ({ lowGfx: !s.lowGfx })),
  toggleCityView: () => set((s) => (s.interior ? s : { cityView: !s.cityView, panel: null })),
  toggleNight: () => set((s) => ({ night: !s.night })),
  setWelcome: (welcome) => set({ welcome }),
  addScore: (n) => set((s) => ({ score: s.score + n })),
  setEmote: (emote) => set({ emote }),
  enterInterior: (interior, exitPos) => set({ interior, exitPos, focus: null, selected: null, lang: null, q: '', sort: 'stars', jumpTo: null, warp: null, floor: 0, panel: null, nearby: null, cityView: false }),
  exitInterior: () => set({ interior: null, focus: null, selected: null, jumpTo: null, warp: null }),
  setFocus: (focus) => set({ focus }),
}));
