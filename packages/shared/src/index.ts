export * from './city';
import { z } from 'zod';

export const SESSION_COOKIE = 'gitcity_sid';
export const API_PREFIX = '/v1';

export const sessionUserSchema = z.object({
  id: z.string(),
  githubId: z.string(),
  username: z.string(),
  displayName: z.string().nullable(),
  avatarUrl: z.string().url().nullable(),
  bio: z.string().nullable(),
  role: z.enum(['USER', 'MODERATOR', 'ADMIN']),
  onboardingStep: z.number().int().min(0),
  onboardingComplete: z.boolean(),
});
export type SessionUser = z.infer<typeof sessionUserSchema>;

export const healthSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  service: z.string(),
  uptime: z.number(),
  checks: z.record(z.enum(['up', 'down', 'skipped'])),
});
export type Health = z.infer<typeof healthSchema>;

export interface ApiError {
  error: { code: string; message: string };
}
