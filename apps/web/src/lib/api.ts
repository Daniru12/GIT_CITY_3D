import type { CityBuilding, CitySnapshot, GithubRepoSummary, GithubStats, SessionUser } from '@gitcity/shared';

export const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

export class ApiRequestError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}/v1${path}`, { credentials: 'include', ...init });
  if (!res.ok) throw new ApiRequestError(res.status, res.statusText);
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export const api = {
  config: () => request<{ devLogin: boolean; github: boolean }>('/auth/config'),
  devLogin: (username: string) =>
    request<SessionUser>('/auth/dev-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username }),
    }),
  githubStats: () => request<{ stats: GithubStats | null }>('/auth/github-stats'),
  city: () => request<CitySnapshot>('/city'),
  buildingProjects: (id: string) => request<{ projects: GithubRepoSummary[] }>(`/city/building/${encodeURIComponent(id)}/projects`),
  myBuilding: () => request<{ building: CityBuilding | null }>('/city/me'),
  me: () => request<SessionUser>('/auth/me'),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
  deleteAccount: () => request<void>('/auth/account', { method: 'DELETE' }),
  githubLoginUrl: (returnTo?: string) =>
    `${API_URL}/v1/auth/github/login${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ''}`,
};
