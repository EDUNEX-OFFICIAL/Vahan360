import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { accessTokenFromRequest } from './auth.utils';
import { isAuthDisabled, isAuthAllowBearer } from './auth-env';
import { IS_PUBLIC_KEY } from './public.decorator';


@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Dev/test escape hatch: DISABLE_AUTH=true skips all JWT checks.
    if (isAuthDisabled()) return true;

    // Routes/controllers decorated with @Public() bypass auth.
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const resolved = accessTokenFromRequest(req, isAuthAllowBearer());
    if (resolved.status === 'bearer_deprecated') {
      throw new UnauthorizedException({
        statusCode: 401,
        error: 'Bearer authentication is deprecated. Use httpOnly cookie session.',
        code: 'bearer_deprecated',
      });
    }
    if (resolved.status === 'missing') {
      throw new UnauthorizedException('Access denied. No token provided.');
    }
    const user = await this.auth.authenticateAccessToken(resolved.token);
    req.vahanJwtUser = user;
    return true;
  }
}
