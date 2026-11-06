# GitCity 3D

Where Developers Build Their Own World. A persistent, multiplayer 3D city for developers, with GitHub as the identity system.

## Status

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Monorepo, API, realtime, web, Prisma schema, Docker, env validation, logging, health checks | Code written, **not yet run** |
| 2 | GitHub OAuth, server-side sessions, protected routes, logout, account deletion | Code written, **not yet run** |
| 3–12 | 3D world → production readiness | Not started |

## Layout

- `apps/web` — React + Vite + Tailwind client
- `apps/api` — NestJS (Fastify) REST API: auth, sessions, health
- `apps/realtime` — Socket.IO server (health only until Phase 6)
- `packages/shared` — shared types and zod schemas
- `packages/database` — Prisma schema (full data model) and client

## Local setup

Requires Node 20+, pnpm 9, Docker.

1. `pnpm install`
2. `cp .env.example .env`, then fill in the values (see below).
3. `docker compose up -d postgres redis`
4. `pnpm db:generate` then `pnpm db:migrate` (creates the first migration)
5. `pnpm dev` — web on :5173, API on :4000, realtime on :4001

Health checks: `GET http://localhost:4000/v1/health` and `GET http://localhost:4001/health`.

### GitHub OAuth setup (you must do this)

1. Open https://github.com/settings/developers → New OAuth App.
2. Homepage URL: `http://localhost:5173`
3. Authorization callback URL: `http://localhost:4000/v1/auth/github/callback`
4. Put the Client ID and a generated Client Secret into `.env`.
5. Generate `SESSION_SECRET` (32+ chars): `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

Only the `read:user` scope is requested. The GitHub access token is used once at login and discarded.

## Auth design

- OAuth `state` is a random value held in a short-lived HttpOnly cookie and compared in constant time on callback.
- `returnTo` is restricted to same-site relative paths (no open redirects).
- Users are keyed by GitHub numeric ID; username and profile are refreshed on each login.
- Sessions are opaque random tokens; only a SHA-256 hash is stored in Postgres. Cookie is HttpOnly, SameSite=Lax, Secure in production, 30-day expiry.
- State-changing requests must carry an `Origin` equal to `FRONTEND_URL`.
- `DELETE /v1/auth/account` removes the user and cascades owned data.

## API (so far)

`GET /v1/health` · `GET /v1/auth/github/login` · `GET /v1/auth/github/callback` · `GET /v1/auth/me` · `POST /v1/auth/logout` · `DELETE /v1/auth/account`

## Not yet done (Phase 2 gaps)

- OpenAPI/Swagger docs
- Disconnect-GitHub endpoint, API integration tests (Supertest), Playwright E2E
- Dockerfiles and CI workflow
- shadcn/ui setup (Tailwind is configured; components not yet added)
