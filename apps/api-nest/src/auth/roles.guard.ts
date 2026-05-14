import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { isAuthDisabled } from './auth-env';
import { ROLES_KEY } from './roles.decorator';
import { userHasRole } from './rbac.permissions';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (isAuthDisabled()) {
      return true;
    }

    const required =
      this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];

    if (required.length === 0) {
      return true;
    }

    const req = context.switchToHttp().getRequest<Request>();
    const user = req.vahanJwtUser;
    if (!user) {
      throw new ForbiddenException('Forbidden.');
    }

    if (!userHasRole(user, ...required)) {
      throw new ForbiddenException('Insufficient role.');
    }

    return true;
  }
}
