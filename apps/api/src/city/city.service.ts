import { Injectable, Logger } from '@nestjs/common';
import {
  CITY_SEED,
  THEMES,
  nextSlot,
  radiusFor,
  type CityBuilding,
  type CitySnapshot,
  type GithubRepoSummary,
} from '@gitcity/shared';
import { PrismaService } from '../infra.module';
import { fetchPublicRepos } from '../auth/github.client';

const CLAIM_LOCK = 727001; // pg advisory lock key serialising plot allocation
const DISTRICT_NAMES = ['Central District', 'Commit Heights', 'Branch Boulevard', 'Merge Quarter', 'Fork Fields'];

type BuildingRow = {
  id: string;
  name: string;
  exterior: unknown;
  createdAt: Date;
  owner: { username: string; avatarUrl: string | null; githubStats: unknown };
  plot: { slotKey: string };
};

function toDto(b: BuildingRow): CityBuilding {
  const ext = (b.exterior ?? {}) as { theme?: string };
  return {
    id: b.id,
    slot: b.plot.slotKey,
    name: b.name,
    theme: ext.theme && THEMES[ext.theme] ? ext.theme : 'mixed',
    ownerUsername: b.owner.username,
    ownerAvatarUrl: b.owner.avatarUrl,
    projects: ((b.owner.githubStats as { topRepos?: GithubRepoSummary[] } | null)?.topRepos ?? []).slice(0, 5),
    createdAt: b.createdAt.toISOString(),
  };
}

@Injectable()
export class CityService {
  private readonly log = new Logger(CityService.name);
  constructor(private readonly prisma: PrismaService) {}

  private readonly include = {
    owner: { select: { username: true, avatarUrl: true, githubStats: true } },
    plot: { select: { slotKey: true } },
  } as const;

  async snapshot(): Promise<CitySnapshot> {
    const rows = await this.prisma.building.findMany({
      include: this.include,
      orderBy: { createdAt: 'asc' },
    });
    return {
      seed: CITY_SEED,
      radius: radiusFor(rows.length),
      developers: rows.length,
      buildings: rows.map(toDto),
    };
  }

  private readonly repoLookups = new Map<string, number>(); // buildingId -> earliest next GitHub lookup (ms)

  /**
   * Every public project of one building's owner (public data only).
   * Accounts saved before full lists were stored only have the top few; for those we read GitHub's public API once,
   * persist the result, and throttle retries so a failing lookup is not repeated on every request.
   */
  async projectsOf(buildingId: string): Promise<GithubRepoSummary[]> {
    const b = await this.prisma.building.findUnique({
      where: { id: buildingId },
      select: { owner: { select: { id: true, username: true, githubStats: true } } },
    });
    if (!b) return [];
    const stats = (b.owner.githubStats ?? null) as { repos?: GithubRepoSummary[]; topRepos?: GithubRepoSummary[] } | null;
    if (stats?.repos?.length) return stats.repos;
    const fallback = stats?.topRepos ?? [];

    const now = Date.now();
    if ((this.repoLookups.get(buildingId) ?? 0) > now) return fallback;
    this.repoLookups.set(buildingId, now + 10 * 60_000);
    const fresh = await fetchPublicRepos(b.owner.username);
    if (!fresh || fresh.length === 0) return fallback;
    await this.prisma.user
      .update({ where: { id: b.owner.id }, data: { githubStats: { ...(stats ?? {}), repos: fresh } as unknown as object } })
      .catch((err) => this.log.warn(`Could not cache repo list: ${err instanceof Error ? err.message : 'unknown error'}`));
    return fresh;
  }

  async mine(userId: string): Promise<CityBuilding | null> {
    const b = await this.prisma.building.findUnique({ where: { ownerId: userId }, include: this.include });
    return b ? toDto(b) : null;
  }

  /**
   * Idempotent plot + building allocation for a developer.
   * - The caller supplies only its authenticated user id; the plot is chosen server-side.
   * - A transaction-scoped advisory lock serialises concurrent claims (simultaneous logins).
   * - Unique constraints on Plot.slotKey and Building.ownerId are the final safety net.
   */
  async ensureBuilding(userId: string, theme: string): Promise<{ building: CityBuilding; created: boolean }> {
    const existing = await this.mine(userId);
    if (existing) return { building: existing, created: false };

    const themeId = THEMES[theme] ? theme : 'mixed';
    const result = await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CLAIM_LOCK})`;

        const again = await tx.building.findUnique({ where: { ownerId: userId }, include: this.include });
        if (again) return { row: again, created: false };

        const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
        const taken = new Set((await tx.plot.findMany({ select: { slotKey: true } })).map((p) => p.slotKey));
        const slot = nextSlot(taken);
        if (!slot) throw new Error('The city is full');

        const band = Math.floor((slot.ring - 1) / 2);
        const district = await tx.district.upsert({
          where: { originX_originZ: { originX: band * 100, originZ: 0 } },
          update: {},
          create: {
            name: DISTRICT_NAMES[band] ?? `District ${band + 1}`,
            theme: 'general',
            originX: band * 100,
            originZ: 0,
            capacity: 1000,
          },
        });
        const idx = Number(slot.id.split(':')[2]);
        const plot = await tx.plot.create({
          data: {
            districtId: district.id,
            gridX: slot.bx * 2 + (idx >> 1),
            gridZ: slot.bz * 2 + (idx & 1),
            slotKey: slot.id,
            status: 'CLAIMED',
            ownerId: userId,
            claimedAt: new Date(),
          },
        });
        const row = await tx.building.create({
          data: {
            plotId: plot.id,
            ownerId: userId,
            name: `${user.username}'s ${THEMES[themeId].label}`,
            type: 'DEVELOPER_HOUSE',
            exterior: { theme: themeId },
          },
          include: this.include,
        });
        await tx.auditLog.create({
          data: { actorId: userId, action: 'building.create', targetType: 'Building', targetId: row.id, metadata: { slot: slot.id, theme: themeId } },
        });
        return { row, created: true };
      },
      { timeout: 15000 },
    );
    if (result.created) this.log.log(`New building for ${result.row.owner.username} at slot ${result.row.plot.slotKey}`);
    return { building: toDto(result.row), created: result.created };
  }
}
