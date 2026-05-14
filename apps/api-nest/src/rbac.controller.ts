import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from './auth/current-user.decorator';
import type { NestJwtUser } from './auth/auth.types';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { TenantId } from './auth/tenant-id.decorator';
import {
  normalizeRolesFromDb,
  orgEchoFromJwt,
  permissionsDetailedFromRoles,
  permissionsFromNormalizedRoles,
} from './auth/rbac.permissions';

@ApiTags('rbac')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('rbac')
export class RbacController {
  @Get('me')
  @ApiOperation({
    summary:
      'JWT roles + normalized slugs; `orgs` / `permissionsDetailed` are structured echoes (no DB ACL table).',
  })
  getMe(@CurrentUser() user: NestJwtUser, @TenantId() tenantId: string) {
    const rolesNormalized = normalizeRolesFromDb(user.roles);
    const permissions = permissionsFromNormalizedRoles(rolesNormalized);
    return {
      username: user.username,
      roles: user.roles,
      rolesNormalized,
      tenantId,
      jwtTenantId: user.jwtTenantId,
      jwtParentTenantId: user.jwtParentTenantId,
      jwtOrgId: user.jwtOrgId,
      jwtOrgPath: user.jwtOrgPath,
      dbTenantId: user.dbTenantId,
      orgs: orgEchoFromJwt(user),
      permissions,
      permissionsDetailed: permissionsDetailedFromRoles(rolesNormalized),
    };
  }
}
