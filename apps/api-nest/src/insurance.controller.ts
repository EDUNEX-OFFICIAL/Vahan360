import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Roles } from './auth/roles.decorator';
import { RolesGuard } from './auth/roles.guard';
import { TenantId } from './auth/tenant-id.decorator';
import { InsuranceService } from './insurance.service';

const DEFAULT_DAYS = 30;
const MIN_DAYS = 1;
const MAX_DAYS = 365;

function parseDays(raw: string | undefined): number {
  if (raw == null || String(raw).trim() === '') return DEFAULT_DAYS;
  const n = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n)) return DEFAULT_DAYS;
  if (n < MIN_DAYS) return MIN_DAYS;
  if (n > MAX_DAYS) return MAX_DAYS;
  return n;
}

@ApiTags('insurance')
@UseGuards(RolesGuard)
@Roles('USER', 'ADMIN')
@Controller('insurance')
export class InsuranceController {
  constructor(private readonly insuranceService: InsuranceService) {}

  @Get('expiring')
  @ApiOperation({
    summary: 'Latest raw insurance captures (ingest `RawInsurance`)',
    description:
      'Returns recent `ingest.raw_insurances` rows (newest `capturedAt` first, up to 100). `days` is reserved for future expiry filtering; echoed in the response. Clamped [1, 365]; default 30.',
  })
  @ApiQuery({
    name: 'days',
    required: false,
    type: Number,
    description: 'Look-ahead window in days (default 30, min 1, max 365).',
    example: 30,
  })
  @ApiQuery({
    name: 'from',
    required: false,
    description: 'Optional inclusive ISO lower bound on `capturedAt`.',
  })
  @ApiQuery({
    name: 'to',
    required: false,
    description: 'Optional inclusive ISO upper bound on `capturedAt`.',
  })
  getExpiring(
    @TenantId() tenantId: string,
    @Query('days') days?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const clamped = parseDays(days);
    return this.insuranceService.getExpiring(clamped, tenantId, from, to);
  }
}
