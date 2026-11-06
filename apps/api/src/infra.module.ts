import { Global, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { PrismaClient } from '@gitcity/database';
import { ENV, loadEnv } from './env';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  async onModuleDestroy() {
    await this.$disconnect();
  }
}

/** Redis is optional in development; without it presence/coordination is single-instance only. */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly client: Redis | null;

  constructor() {
    const url = loadEnv().REDIS_URL;
    this.client = url
      ? new Redis(url, { maxRetriesPerRequest: 1, retryStrategy: (n) => Math.min(n * 500, 5000) })
      : null;
    this.client?.on('error', () => undefined); // surfaced via health check instead
  }

  get enabled(): boolean {
    return this.client !== null;
  }

  async ping(): Promise<boolean> {
    return this.client ? (await this.client.ping()) === 'PONG' : false;
  }

  onModuleDestroy() {
    this.client?.disconnect();
  }
}

@Global()
@Module({
  providers: [PrismaService, RedisService, { provide: ENV, useFactory: () => loadEnv() }],
  exports: [PrismaService, RedisService, ENV],
})
export class InfraModule {}
