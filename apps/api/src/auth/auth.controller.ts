import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Logger,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  SESSION_COOKIE,
  THEMES,
  themeFromLanguages,
  type GithubStats,
  type SessionUser,
} from '@gitcity/shared';
import { CityService } from '../city/city.service';
import { ENV, type Env } from '../env';
import { AuthGuard, type AuthedRequest } from './auth.guard';
import { AuthService, SESSION_TTL_MS, toSessionUser } from './auth.service';
import { GitHubError } from './github.client';
import { newToken, safeEqual, safeReturnTo } from './tokens';

const STATE_COOKIE = 'gitcity_oauth';

@Controller('auth')
export class AuthController {
  private readonly log = new Logger(AuthController.name);
  private readonly secure: boolean;

  constructor(
    private readonly auth: AuthService,
    private readonly city: CityService,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.secure = env.NODE_ENV === 'production';
  }

  private cookieOpts(maxAgeMs: number) {
    return {
      httpOnly: true,
      secure: this.secure,
      sameSite: 'lax' as const,
      path: '/',
      maxAge: Math.floor(maxAgeMs / 1000),
    };
  }

  @Get('github/login')
  login(@Query('returnTo') returnTo: string | undefined, @Res() res: FastifyReply) {
    if (!this.githubConfigured) return res.redirect(`${this.env.FRONTEND_URL}/login?error=notconfigured`, 302);
    const state = newToken();
    // state and the validated return path are bound together in one short-lived HttpOnly cookie
    const payload = Buffer.from(JSON.stringify({ s: state, r: safeReturnTo(returnTo) })).toString('base64url');
    res.setCookie(STATE_COOKIE, payload, this.cookieOpts(10 * 60 * 1000));
    return res.redirect(this.auth.github.authorizeUrl(state, this.auth.callbackUrl), 302);
  }

  @Get('github/callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') oauthError: string | undefined,
    @Req() req: FastifyRequest,
    @Res() res: FastifyReply,
  ) {
    const fail = (reason: string) => res.redirect(`${this.env.FRONTEND_URL}/login?error=${reason}`, 302);
    res.clearCookie(STATE_COOKIE, { path: '/' });

    if (oauthError) return fail('denied');
    let saved: { s: string; r: string } | null = null;
    try {
      saved = JSON.parse(Buffer.from(req.cookies?.[STATE_COOKIE] ?? '', 'base64url').toString());
    } catch {
      saved = null;
    }
    if (!code || !state || !saved || typeof saved.s !== 'string' || !safeEqual(saved.s, state)) {
      return fail('state');
    }

    try {
      const accessToken = await this.auth.github.exchangeCode(code, this.auth.callbackUrl);
      const ghUser = await this.auth.github.fetchUser(accessToken); // token is used now and discarded, never stored
      const user = await this.auth.upsertFromGitHub(ghUser);
      if (user.bannedAt) return fail('banned');

      // Public GitHub data (best effort: a GitHub hiccup must never block sign-in)
      const [repoSummary, contrib] = await Promise.all([
        this.auth.github.fetchRepoSummary(accessToken, ghUser.login).catch(() => null),
        this.auth.github.fetchContributions(accessToken).catch(() => null),
      ]);
      await this.auth.saveGithubStats(user.id, {
        publicRepos: ghUser.public_repos,
        followers: contrib?.followers ?? 0,
        stars: repoSummary?.stars ?? 0,
        commits: contrib?.commits ?? 0,
        pullRequests: contrib?.pullRequests ?? 0,
        issues: contrib?.issues ?? 0,
        reviews: contrib?.reviews ?? 0,
        totalContributions: contrib?.totalContributions ?? 0,
        languages: repoSummary?.languages ?? {},
        topRepos: repoSummary?.topRepos ?? [],
        repos: repoSummary?.repos ?? [],
        syncedAt: new Date().toISOString(),
      });

      // Automatic building creation: idempotent, so returning developers keep their existing building
      await this.city.ensureBuilding(user.id, themeFromLanguages(repoSummary?.languages ?? {}));

      const { token } = await this.auth.createSession(user.id, req.headers['user-agent']);
      res.setCookie(SESSION_COOKIE, token, this.cookieOpts(SESSION_TTL_MS));
      return res.redirect(`${this.env.FRONTEND_URL}${safeReturnTo(saved.r)}`, 302); // default: the 3D city
    } catch (err) {
      this.log.warn(`OAuth callback failed: ${err instanceof Error ? err.message : 'unexpected error'}`);
      return fail(err instanceof GitHubError ? 'github' : 'server');
    }
  }

  private get githubConfigured(): boolean {
    return this.env.GITHUB_CLIENT_ID !== 'dev-placeholder' && this.env.GITHUB_CLIENT_SECRET !== 'dev-placeholder';
  }

  private get devLoginEnabled(): boolean {
    return this.env.DEV_LOGIN && this.env.NODE_ENV !== 'production';
  }

  @Get('config')
  config() {
    return { devLogin: this.devLoginEnabled, github: this.githubConfigured };
  }

  /** Development only: sign in as a local fake developer without GitHub. Disabled in production. */
  @Post('dev-login')
  async devLogin(
    @Body() body: { username?: string },
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<SessionUser> {
    if (!this.devLoginEnabled) throw new ForbiddenException();
    const username = String(body?.username ?? '').trim();
    if (!/^[a-zA-Z0-9-]{2,39}$/.test(username)) throw new ForbiddenException('Invalid username');
    const user = await this.auth.upsertDevUser(username);
    const themeIds = Object.keys(THEMES);
    const pick = themeIds[[...username].reduce((a, c) => a + c.charCodeAt(0), 0) % themeIds.length];
    await this.city.ensureBuilding(user.id, pick);
    const { token } = await this.auth.createSession(user.id, req.headers['user-agent']);
    res.setCookie(SESSION_COOKIE, token, this.cookieOpts(SESSION_TTL_MS));
    return toSessionUser(user);
  }

  @Get('me')
  @UseGuards(AuthGuard)
  me(@Req() req: AuthedRequest): SessionUser {
    return toSessionUser(req.user);
  }

  /** Public GitHub stats captured at the last sign-in (null for developer-mode accounts). */
  @Get('github-stats')
  @UseGuards(AuthGuard)
  githubStats(@Req() req: AuthedRequest) {
    return { stats: (req.user.githubStats as unknown as GithubStats | null) ?? null };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: FastifyRequest, @Res({ passthrough: true }) res: FastifyReply) {
    await this.auth.destroySession(req.cookies?.[SESSION_COOKIE]);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
  }

  @Delete('account')
  @UseGuards(AuthGuard)
  @HttpCode(204)
  async deleteAccount(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: FastifyReply) {
    await this.auth.deleteAccount(req.user.id);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
  }
}
