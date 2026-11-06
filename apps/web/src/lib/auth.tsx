import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { api, ApiRequestError } from './api';

export function useSession() {
  return useQuery({
    queryKey: ['session'],
    queryFn: async () => {
      try {
        return await api.me();
      } catch (e) {
        if (e instanceof ApiRequestError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
    retry: false,
  });
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { data, isLoading, isError } = useSession();
  const loc = useLocation();
  if (isLoading) return <p className="p-8 text-slate-400">Loading…</p>;
  if (isError) return <p className="p-8 text-red-400">Could not reach the server. Try again shortly.</p>;
  if (!data) return <Navigate to={`/login?returnTo=${encodeURIComponent(loc.pathname)}`} replace />;
  return <>{children}</>;
}
