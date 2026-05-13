import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from './auth/roles.decorator';
import { RolesGuard } from './auth/roles.guard';
import { TenantId } from './auth/tenant-id.decorator';
import { VehicleTimelineQueryDto } from './vehicle-timeline-query.dto';
import { VehicleService } from './vehicle.service';

@ApiTags('vehicle')
@UseGuards(RolesGuard)
@Roles('USER', 'ADMIN')
@Controller('vehicle')
export class VehicleController {
  constructor(private readonly vehicleService: VehicleService) {}

  private asOf(): string {
    return new Date().toISOString();
  }

  @Get(':regNorm/summary')
  @ApiOperation({
    summary:
      'Vehicle compliance summary from processed.vehicle_compliance_summary when DB is configured',
  })
  @ApiParam({ name: 'regNorm', description: 'Vehicle registration (trimmed, uppercased for lookup)' })
  @ApiResponse({
    status: 200,
    description:
      '`{ status: "ok", data }` when a row exists; `{ status: "not_found", regNorm }` otherwise; `{ status: "not_implemented", reason }` if env/Prisma fails.',
  })
  getSummary(@Param('regNorm') regNorm: string) {
    return this.vehicleService.getComplianceSummary(regNorm);
  }

  @Get(':regNorm/timeline')
  @ApiOperation({
    summary:
      'Recent ingest.job_events for scrape jobs whose payload (or event payload) references this registration',
  })
  @ApiParam({ name: 'regNorm', description: 'Normalized vehicle registration' })
  getTimeline(
    @Param('regNorm') regNorm: string,
    @TenantId() tenantId: string,
    @Query() query: VehicleTimelineQueryDto,
  ) {
    const limit = query.limit ?? 50;
    return this.vehicleService.getVehicleTimeline(regNorm, limit, tenantId);
  }

  @Get(':regNorm/risk')
  @ApiOperation({
    summary:
      'Weighted risk score (0–100) + explainability from processed compliance snapshot',
  })
  @ApiParam({ name: 'regNorm', description: 'Normalized vehicle registration' })
  @ApiResponse({
    status: 200,
    description:
      '`status: "ok"` returns `score`, `tier`, `band`, `signals`, `reasons`, and weighted `factors`; `not_found` has null score/tier; `not_implemented` carries reason for DB/env failures.',
    content: {
      'application/json': {
        examples: {
          ok: {
            summary: 'Computed',
            value: {
              regNorm: 'BR01AB1234',
              status: 'ok',
              score: 52,
              tier: 'medium',
              band: 'medium',
              signals: ['permitExpired=true', 'violationCount=2'],
              reasons: ['Permit appears expired/invalid in compliance snapshot.'],
              factors: [
                {
                  key: 'permit_validity',
                  label: 'Permit validity',
                  weight: 24,
                  contribution: 24,
                  reason: 'Permit appears expired/invalid in compliance snapshot.',
                },
              ],
              asOf: '2026-05-13T12:00:00.000Z',
            },
          },
          notFound: {
            summary: 'No row',
            value: {
              regNorm: 'BR01AB1234',
              status: 'not_found',
              score: null,
              tier: null,
              signals: [],
              asOf: '2026-05-13T12:00:00.000Z',
            },
          },
          noSignals: {
            summary: 'Snapshot without risk keys',
            value: {
              regNorm: 'BR01AB1234',
              status: 'not_implemented',
              reason: 'no_risk_signals',
              score: null,
              tier: null,
              signals: [],
              asOf: '2026-05-13T12:00:00.000Z',
            },
          },
        },
      },
    },
  })
  getRisk(@Param('regNorm') regNorm: string) {
    return this.vehicleService.getVehicleRisk(regNorm, this.asOf());
  }
}
