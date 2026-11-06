import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** Opaque random token for sessions / OAuth state. */
export function newToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Only the hash of a session token is persisted. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Only same-site relative paths are allowed as post-login redirects (prevents open redirects). */
export function safeReturnTo(value: unknown): string {
  if (typeof value !== 'string') return '/world';
  if (!/^\/(?![/\\])[\w\-./?=&%]*$/.test(value)) return '/world';
  return value;
}
