import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { Roles } from './auth/roles.decorator';
import { RolesGuard } from './auth/roles.guard';

let cachedVersion: string | undefined;

function getVersion(): string {
  if (cachedVersion !== undefined) return cachedVersion;
  try {
    const raw = readFileSync(join(__dirname, '..', 'package.json'), 'utf8');
    const pkg = JSON.parse(raw) as { version?: string };
    cachedVersion = pkg.version ?? '0.0.0';
  } catch {
    cachedVersion = 'unknown';
  }
  return cachedVersion;
}

@ApiTags('control')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ANALYST', 'OPS', 'ADMIN')
@Controller('control')
export class ControlController {
  @Get('status')
  @ApiOperation({ summary: 'Process status — version, uptime, Node.js version' })
  getStatus() {
    return {
      service: 'vahan360-api-nest',
      version: getVersion(),
      uptime: process.uptime(),
      node: process.version,
    };
  }
}
