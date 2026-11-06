import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Github } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from './lib/api';
import { useSession } from './lib/auth';

const ERRORS: Record<string, string> = {
  notconfigured:
    'GitHub login is not set up yet. Add GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET to .env, or use developer login below.',
  denied: 'GitHub authorization was cancelled.',
  state: 'Sign-in session expired or was invalid. Please try again.',
  github: 'GitHub could not be reached or rate-limited us. Please try again shortly.',
  banned: 'This account is not permitted to sign in.',
  server: 'Something went wrong on our side. Please try again.',
};

const btn =
  'inline-flex items-center gap-2 rounded-lg px-5 py-3 font-semibold transition hover:brightness-110';

export function Landing() {
  const { data: user } = useSession();
  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col items-center justify-center gap-6 px-6 text-center">
      <p className="text-secondary">Where Developers Build Their Own World.</p>
      <h1 className="text-5xl font-extrabold md:text-6xl">Your Code. Your Building. Your City.</h1>
      <p className="max-w-2xl text-slate-300">
        Connect your GitHub account, create your own 3D developer space, explore a growing virtual
        city, and hang out with developers worldwide.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        {user ? (
          <Link to="/world" className={`${btn} bg-primary text-white`}>
            Enter My 3D World (@{user.username})
          </Link>
        ) : (
          <Link to="/login" className={`${btn} bg-primary text-white`}>
            <Github size={20} /> Enter GitCity with GitHub
          </Link>
        )}
        <Link to="/world" className={`${btn} border border-secondary text-secondary`}>
          Explore the World
        </Link>
      </div>
    </main>
  );
}

function DevLogin() {
  const [name, setName] = useState('dev-' + Math.floor(Math.random() * 1000));
  const qc = useQueryClient();
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="flex w-full flex-col gap-2 rounded-xl border border-dashed border-secondary/50 p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          const user = await api.devLogin(name);
          qc.setQueryData(['session'], user);
          nav('/world');
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="text-xs text-secondary">Developer mode: sign in without GitHub</p>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="rounded-lg bg-surface px-3 py-2"
        aria-label="Dev username"
      />
      <button disabled={busy} className={`${btn} justify-center bg-secondary text-bg`}>
        Dev login
      </button>
    </form>
  );
}

export function Login() {
  const [params] = useSearchParams();
  const err = params.get('error');
  const cfg = useQuery({ queryKey: ['auth-config'], queryFn: api.config, retry: false });
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-5 px-6">
      <h1 className="text-3xl font-bold">Sign in to GitCity</h1>
      {err && (
        <p role="alert" className="rounded-lg bg-red-500/10 p-3 text-sm text-red-300">
          {ERRORS[err] ?? ERRORS.server}
        </p>
      )}
      <a href={api.githubLoginUrl(params.get('returnTo') ?? undefined)} className={`${btn} bg-primary text-white`}>
        <Github size={20} /> Continue with GitHub
      </a>
      {cfg.data?.devLogin && <DevLogin />}
      <p className="text-center text-xs text-slate-400">
        We only request your public profile (read:user). We never ask for repository access.
      </p>
    </main>
  );
}

export function Dashboard() {
  const { data: user } = useSession();
  const qc = useQueryClient();
  const nav = useNavigate();
  if (!user) return null;
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <header className="flex items-center gap-4">
        {user.avatarUrl && <img src={user.avatarUrl} alt="" className="h-16 w-16 rounded-full" />}
        <div>
          <h1 className="text-2xl font-bold">Welcome, {user.displayName ?? user.username}!</h1>
          <p className="text-slate-400">@{user.username}</p>
        </div>
      </header>
      <section className="mt-8 rounded-xl bg-surface p-6">
        <p className="text-slate-300">
          Your building and the 3D city arrive in the next phases. You are signed in securely.
        </p>
      </section>
      <button
        className={`${btn} mt-8 bg-surface text-slate-200`}
        onClick={async () => {
          await api.logout();
          qc.setQueryData(['session'], null);
          nav('/');
        }}
      >
        Log out
      </button>
    </main>
  );
}

export function Onboarding() {
  return (
    <main className="mx-auto max-w-xl px-6 py-16 text-center">
      <h1 className="text-3xl font-bold">Welcome to GitCity, Developer!</h1>
      <p className="mt-4 text-slate-300">Onboarding (avatar, building, district, plot) is implemented in Phase 4.</p>
      <Link to="/dashboard" className={`${btn} mt-6 bg-primary text-white`}>
        Continue to dashboard
      </Link>
    </main>
  );
}

export function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-4xl font-bold">404</h1>
      <Link to="/" className="text-secondary underline">
        Back to GitCity
      </Link>
    </main>
  );
}
