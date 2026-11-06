import 'reflect-metadata';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { loadEnv } from './env';

async function bootstrap() {
  const env = loadEnv(); // fail fast on bad configuration
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ bodyLimit: 100 * 1024, trustProxy: true }),
    { bufferLogs: true },
  );
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix('v1');

  // Plugins are cast: @nestjs/platform-fastify may bundle a different fastify type copy.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  await app.register(helmet as any);
  await app.register(cookie as any, { secret: env.SESSION_SECRET });
  await app.register(cors as any, { origin: env.FRONTEND_URL, credentials: true });
  await app.register(rateLimit as any, { max: 300, timeWindow: '1 minute' });

  // CSRF defence in depth (SameSite=Lax cookies + Origin check on state-changing requests)
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onRequest', async (req, reply) => {
      if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
      if (req.headers.origin !== env.FRONTEND_URL) {
        return reply.status(403).send({ error: { code: 'CSRF', message: 'Invalid request origin' } });
      }
    });

  app.enableShutdownHooks();
  await app.listen(env.API_PORT, '0.0.0.0');
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
