import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { normalizeTenantSlug } from '../ingest-tenant-scope';
import { isAuthDisabled } from './auth-env';
import { IS_PUBLIC_KEY } from './public.decorator';
import { parseTenantAllowlist, resolvedDefaultTenantSlug } from './tenant.constants';

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (isAuthDisabled()) {
      const req = context.switchToHttp().getRequest<Request>();
      req.vahanTenantId = normalizeTenantSlug(resolvedDefaultTenantSlug());
      return true;
    }

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const req = context.switchToHttp().getRequest<Request>();
    const user = req.vahanJwtUser;
    if (!user) {
      throw new ForbiddenException('Tenant guard requires an authenticated user.');
    }

    const headerTid = req.get('x-tenant-id')?.trim() || null;
    const jwtTid = user.jwtTenantId;
    if (jwtTid && headerTid && jwtTid !== headerTid) {
      throw new BadRequestException(
        'X-Tenant-Id header disagrees with access token tid claim.',
      );
    }

    const headerOid = req.get('x-org-id')?.trim() || null;
    if (user.jwtOrgId && headerOid && user.jwtOrgId !== headerOid) {
      throw new BadRequestException(
        'X-Org-Id header disagrees with access token oid claim.',
      );
    }

    const headerOpath = req.get('x-org-path')?.trim() || null;
    if (user.jwtOrgPath && headerOpath && user.jwtOrgPath !== headerOpath) {
      throw new BadRequestException(
        'X-Org-Path header disagrees with access token opath claim.',
      );
    }

    const headerPtid = req.get('x-parent-tid')?.trim() || null;
    if (
      user.jwtParentTenantId &&
      headerPtid &&
      user.jwtParentTenantId !== headerPtid
    ) {
      throw new BadRequestException(
        'X-Parent-Tid header disagrees with access token ptid claim.',
      );
    }

    const effective = normalizeTenantSlug(
      jwtTid ?? headerTid ?? user.dbTenantId ?? resolvedDefaultTenantSlug(),
    );

    if (user.dbTenantId && user.dbTenantId !== effective) {
      throw new ForbiddenException('Tenant is not authorized for this user.');
    }

    const allow = parseTenantAllowlist();
    if (allow && !allow.has(effective)) {
      throw new ForbiddenException('Tenant is not allowed for this deployment.');
    }

    req.vahanTenantId = effective;
    return true;
  }
}
