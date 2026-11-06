import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { SESSION_COOKIE } from '@gitcity/shared';
import { AuthService } from './auth.service';

export type AuthedRequest = FastifyRequest & {
  user: NonNullable<Awaited<ReturnType<AuthService['resolveSession']>>>;
};

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    const user = await this.auth.resolveSession(req.cookies?.[SESSION_COOKIE]);
    if (!user) throw new UnauthorizedException({ error: { code: 'UNAUTHENTICATED', message: 'Sign in required' } });
    (req as AuthedRequest).user = user;
    return true;
  }
}
