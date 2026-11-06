import { Inject, Injectable } from '@nestjs/common';
import type { GithubStats, SessionUser } from '@gitcity/shared';
import { ENV, type Env } from '../env';
import { PrismaService } from '../infra.module';
import { GitHubClient, type GitHubUser } from './github.client';
import { hashToken, newToken } from './tokens';

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type DbUser = NonNullable<Awaited<ReturnType<PrismaService['user']['findUnique']>>>;

export function toSessionUser(u: DbUser): SessionUser {
  return {
    id: u.id,
    githubId: u.githubId.toString(),
    username: u.username,
    displayName: u.displayName,
    avatarUrl: u.avatarUrl,
    bio: u.bio,
    role: u.role,
    onboardingStep: u.onboardingStep,
    onboardingComplete: u.onboardingComplete,
  };
}

@Injectable()
export class AuthService {
  readonly github: GitHubClient;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.github = new GitHubClient(env.GITHUB_CLIENT_ID, env.GITHUB_CLIENT_SECRET);
  }

  get callbackUrl(): string {
    return `${this.env.API_URL}/v1/auth/github/callback`;
  }

  /** The GitHub numeric id is the stable identity key; username/profile are refreshed each login. */
  async upsertFromGitHub(gh: GitHubUser): Promise<DbUser> {
    const profile = {
      username: gh.login,
      displayName: gh.name,
      avatarUrl: gh.avatar_url,
      bio: gh.bio,
    };
    return this.prisma.user.upsert({
      where: { githubId: BigInt(gh.id) },
      update: profile,
      create: { githubId: BigInt(gh.id), ...profile, settings: { create: {} } },
    });
  }

  /** Dev-only fake accounts use negative githubIds so they can never collide with real GitHub users. */
  async upsertDevUser(username: string): Promise<DbUser> {
    const existing = await this.prisma.user.findFirst({ where: { username, githubId: { lt: 0 } } });
    if (existing) return existing;
    const githubId = -BigInt(Date.now()) * 1000n - BigInt(Math.floor(Math.random() * 1000));
    return this.prisma.user.create({
      data: { githubId, username, displayName: username, settings: { create: {} } },
    });
  }

  async saveGithubStats(userId: string, stats: GithubStats): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { githubStats: stats as unknown as object, githubSyncedAt: new Date() },
    });
  }

  async createSession(userId: string, userAgent?: string): Promise<{ token: string; expiresAt: Date }> {
    const token = newToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await this.prisma.session.create({
      data: { tokenHash: hashToken(token), userId, userAgent: userAgent?.slice(0, 255), expiresAt },
    });
    return { token, expiresAt };
  }

  async resolveSession(token: string | undefined): Promise<DbUser | null> {
    if (!token) return null;
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    });
    if (!session || session.expiresAt <= new Date() || session.user.bannedAt) return null;
    return session.user;
  }

  async destroySession(token: string | undefined): Promise<void> {
    if (!token) return;
    await this.prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  }

  /** Permanently removes the account; all owned data cascades. */
  async deleteAccount(userId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.auditLog.create({
        data: { actorId: userId, action: 'account.delete', targetType: 'User', targetId: userId },
      }),
      this.prisma.user.delete({ where: { id: userId } }),
    ]);
  }
}
