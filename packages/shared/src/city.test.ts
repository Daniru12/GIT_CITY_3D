import { describe, expect, it } from 'vitest';
import { MAX_RADIUS, PITCH, generateCity, nextSlot, orderedSlots, radiusFor, themeFromLanguages } from './city';

describe('generateCity', () => {
  it('is deterministic for a seed and radius', () => {
    expect(generateCity(7, 2)).toEqual(generateCity(7, 2));
  });
  it('growing the city never moves existing plots', () => {
    const small = generateCity(1337, 1).plots;
    const big = generateCity(1337, 3).plots;
    for (const p of small) expect(big.find((q) => q.id === p.id)).toEqual(p);
  });
  it('never overlaps buildings and keeps roads clear', () => {
    const { plots } = generateCity(1337, 4);
    for (let i = 0; i < plots.length; i++) {
      const a = plots[i];
      const rx = Math.abs((((a.x + PITCH / 2) % PITCH) + PITCH) % PITCH - PITCH / 2);
      expect(rx + a.size / 2).toBeLessThanOrEqual(PITCH / 2 - 4);
      for (let j = i + 1; j < plots.length; j++) {
        const b = plots[j];
        const s = (a.size + b.size) / 2;
        expect(Math.abs(a.x - b.x) < s && Math.abs(a.z - b.z) < s).toBe(false);
      }
    }
  });
  it('keeps the plaza free', () => {
    expect(generateCity(1337, 2).plots.some((p) => Math.abs(p.x) < 15 && Math.abs(p.z) < 15)).toBe(false);
  });
});

describe('growth rules', () => {
  it('has unique slot ids ordered centre-outwards', () => {
    const s = orderedSlots();
    expect(new Set(s.map((p) => p.id)).size).toBe(s.length);
    for (let i = 1; i < s.length; i++) expect(s[i].ring).toBeGreaterThanOrEqual(s[i - 1].ring);
  });
  it('allocates distinct slots and unlocks rings as it fills', () => {
    const taken = new Set<string>();
    let maxRadius = 1;
    for (let i = 0; i < 120; i++) {
      const slot = nextSlot(taken);
      expect(slot).not.toBeNull();
      expect(taken.has(slot!.id)).toBe(false);
      taken.add(slot!.id);
      maxRadius = Math.max(maxRadius, slot!.ring);
    }
    expect(maxRadius).toBeGreaterThan(1);
    expect(radiusFor(0)).toBe(1);
    expect(radiusFor(1e9)).toBe(MAX_RADIUS);
  });
});

describe('themeFromLanguages', () => {
  it('picks a dominant language theme', () => {
    expect(themeFromLanguages({ Python: 8, Shell: 1 })).toBe('python');
    expect(themeFromLanguages({ TypeScript: 3, JavaScript: 3, Go: 1 })).toBe('javascript');
  });
  it('falls back to mixed', () => {
    expect(themeFromLanguages({})).toBe('mixed');
    expect(themeFromLanguages({ Python: 1, Go: 1, Rust: 1, Java: 1 })).toBe('mixed');
  });
});

import { languageColor } from './city';
describe('languageColor', () => {
  it('maps known languages and falls back', () => {
    expect(languageColor('Python')).toBe('#3572a5');
    expect(languageColor(null)).toBe('#8b949e');
    expect(languageColor('Brainfuck')).toBe('#8b949e');
  });
});
