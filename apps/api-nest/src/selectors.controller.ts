import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { getSelectorRegistry } from '@vahan360/scraper-core';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { Roles } from './auth/roles.decorator';
import { RolesGuard } from './auth/roles.guard';

const KNOWN_PORTAL_IDS = [
  'khanan-bihar',
  'vahan-permit',
  'generic-transport',
] as const;

@ApiTags('selectors')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ANALYST', 'OPS', 'ADMIN')
@Controller('selectors')
export class SelectorsController {
  @Get('health')
  @ApiOperation({
    summary:
      'Selector registry health (YAML-backed; no browser / Playwright execution)',
  })
  getHealth(): { portals: string[]; versionHints: Record<string, string> } {
    const portals: string[] = [];
    const versionHints: Record<string, string> = {};

    for (const portalId of KNOWN_PORTAL_IDS) {
      try {
        const reg = getSelectorRegistry(portalId);
        portals.push(reg.portalId);
        versionHints[reg.portalId] = reg.version;
      } catch {
        // omit failed portals
      }
    }

    return { portals, versionHints };
  }
}
