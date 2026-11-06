import { describe, expect, it } from 'vitest';
import { hashToken, newToken, safeEqual, safeReturnTo } from './tokens';

describe('tokens', () => {
  it('generates unique unpredictable tokens', () => {
    expect(newToken()).not.toEqual(newToken());
    expect(newToken().length).toBeGreaterThanOrEqual(43);
  });
  it('hashes deterministically and never returns the token', () => {
    const t = newToken();
    expect(hashToken(t)).toEqual(hashToken(t));
    expect(hashToken(t)).not.toContain(t);
  });
  it('compares in a length-safe way', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('safeReturnTo', () => {
  it('allows relative paths', () => {
    expect(safeReturnTo('/room/invite/abc')).toBe('/room/invite/abc');
  });
  it.each(['//evil.com', 'https://evil.com', '/\\evil.com', undefined, 42])('rejects %s', (v) => {
    expect(safeReturnTo(v)).toBe('/world');
  });
});
