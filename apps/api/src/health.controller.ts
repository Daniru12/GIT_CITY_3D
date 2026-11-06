import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import type { Health } from '@gitcity/shared';
import { PrismaService, RedisService } from './infra.module';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  async check(@Res({ passthrough: true }) res: FastifyReply): Promise<Health> {
    const checks: Record<string, 'up' | 'down' | 'skipped'> = {
      database: 'down',
      redis: this.redis.enabled ? 'down' : 'skipped',
    };
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.database = 'up';
    } catch {
      /* reported as down */
    }
    if (this.redis.enabled) {
      try {
        checks.redis = (await this.redis.ping()) ? 'up' : 'down';
      } catch {
        /* reported as down */
      }
    }
    const ok = Object.values(checks).every((v) => v !== 'down');
    if (!ok) res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return { status: ok ? 'ok' : 'degraded', service: 'api', uptime: process.uptime(), checks };
  }
}
