import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { Roles } from './auth/roles.decorator';
import { RolesGuard } from './auth/roles.guard';
import { TenantId } from './auth/tenant-id.decorator';
import { RawChallanService } from './raw-challan.service';
import { RawKhananService } from './raw-khanan.service';
import { RawFitnessService } from './raw-fitness.service';
import { RawVehicleService } from './raw-vehicle.service';
import { OpsSnapshotService } from './ops-snapshot.service';
import { ScrapeJobService } from './scrape-job.service';
import { AuditLogService } from './audit-log.service';
import { FailedJobReplayService } from './failed-job-replay.service';
import { FailedJobService, type FailedJobOrder } from './failed-job.service';

const DEFAULT_LIMIT = 50;
const MIN_LIMIT = 1;
const MAX_LIMIT = 200;

function parseLimit(raw: string | undefined): number {
  if (raw == null || String(raw).trim() === '') return DEFAULT_LIMIT;
  const n = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n)) return DEFAULT_LIMIT;
  if (n < MIN_LIMIT) return MIN_LIMIT;
  if (n > MAX_LIMIT) return MAX_LIMIT;
  return n;
}

function parseFailedJobOrder(raw: string | undefined): FailedJobOrder {
  const s = raw != null ? String(raw).trim().toLowerCase() : '';
  if (s === 'asc' || s === 'oldest') return 'asc';
  if (s === 'desc' || s === 'newest' || s === '') return 'desc';
  return 'desc';
}

@ApiTags('ingest')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ANALYST', 'OPS', 'ADMIN')
@Controller('ingest/raw-khanan')
export class IngestRawController {
  constructor(private readonly rawKhananService: RawKhananService) {}

  @Get()
  @ApiOperation({
    summary: 'Latest raw Khanan captures (ingest `RawKhananRecord`)',
    description:
      'Returns `ingest.raw_khanan_records` rows ordered by `capturedAt` desc. `limit` is clamped [1, 200] (default 50); at most 100 rows are returned per request.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Requested page size (default 50, min 1, max 200; response capped at 100 rows).',
    example: 50,
  })
  list(
    @TenantId() tenantId: string,
    @Query('limit') limitRaw?: string,
    @Query('district') districtKey?: string,
  ) {
    const limit = parseLimit(limitRaw);
    return this.rawKhananService.list(limit, tenantId, districtKey);
  }
}

@ApiTags('ingest')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ANALYST', 'OPS', 'ADMIN')
@Controller('ingest/raw-vehicle')
export class IngestRawVehicleController {
  constructor(private readonly rawVehicleService: RawVehicleService) {}

  @Get()
  @ApiOperation({
    summary: 'Latest raw vehicle captures (ingest `RawVehicleRecord`)',
    description:
      'Returns `ingest.raw_vehicle_records` rows ordered by `capturedAt` desc. `limit` is clamped [1, 200] (default 50); at most 100 rows are returned per request.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Requested page size (default 50, min 1, max 200; response capped at 100 rows).',
    example: 50,
  })
  list(@TenantId() tenantId: string, @Query('limit') limitRaw?: string) {
    const limit = parseLimit(limitRaw);
    return this.rawVehicleService.list(limit, tenantId);
  }
}

@ApiTags('ingest')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ANALYST', 'OPS', 'ADMIN')
@Controller('ingest/raw-fitness')
export class IngestRawFitnessController {
  constructor(private readonly rawFitnessService: RawFitnessService) {}

  @Get()
  @ApiOperation({
    summary: 'Latest raw fitness captures (ingest `RawFitnessRecord`)',
    description:
      'Returns `ingest.raw_fitness_records` rows ordered by `capturedAt` desc. `limit` is clamped [1, 200] (default 50); at most 100 rows are returned per request.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Requested page size (default 50, min 1, max 200; response capped at 100 rows).',
    example: 50,
  })
  list(@TenantId() tenantId: string, @Query('limit') limitRaw?: string) {
    const limit = parseLimit(limitRaw);
    return this.rawFitnessService.list(limit, tenantId);
  }
}

@ApiTags('ingest')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ANALYST', 'OPS', 'ADMIN')
@Controller('ingest/raw-challan')
export class IngestRawChallanController {
  constructor(private readonly rawChallanService: RawChallanService) {}

  @Get()
  @ApiOperation({
    summary: 'Latest raw challan captures (ingest `RawChallan`)',
    description:
      'Returns `ingest.raw_challans` rows ordered by `capturedAt` desc. `limit` is clamped [1, 200] (default 50); at most 100 rows are returned per request.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Requested page size (default 50, min 1, max 200; response capped at 100 rows).',
    example: 50,
  })
  list(@TenantId() tenantId: string, @Query('limit') limitRaw?: string) {
    const limit = parseLimit(limitRaw);
    return this.rawChallanService.list(limit, tenantId);
  }
}

@ApiTags('ingest')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ANALYST', 'OPS', 'ADMIN')
@Controller('ingest/scrape-jobs')
export class IngestScrapeJobsController {
  constructor(private readonly scrapeJobService: ScrapeJobService) {}

  @Get()
  @ApiOperation({
    summary: 'Latest scrape jobs (`ingest.scrape_jobs`)',
    description:
      'Returns `ingest.scrape_jobs` rows ordered by `createdAt` desc. `limit` is clamped [1, 200] (default 50); at most 100 rows are returned per request. Optional `status` filters by exact `status` string.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Requested page size (default 50, min 1, max 200; response capped at 100 rows).',
    example: 50,
  })
  @ApiQuery({
    name: 'q',
    required: false,
    type: String,
    description:
      'Optional substring / exact-UUID (`id`) search across kind, status, lastError.',
  })
  list(
    @TenantId() tenantId: string,
    @Query('limit') limitRaw?: string,
    @Query('status') statusRaw?: string,
    @Query('q') qRaw?: string,
  ) {
    const limit = parseLimit(limitRaw);
    const status =
      statusRaw != null && String(statusRaw).trim() !== ''
        ? String(statusRaw).trim()
        : undefined;
    const q =
      qRaw != null && String(qRaw).trim() !== ''
        ? String(qRaw).trim()
        : undefined;
    return this.scrapeJobService.list(limit, status, tenantId, q);
  }
}

@ApiTags('ingest')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ANALYST', 'OPS', 'ADMIN')
@Controller('ingest/ops/snapshot')
export class IngestOpsController {
  constructor(private readonly opsSnapshotService: OpsSnapshotService) {}

  @Get()
  @ApiOperation({
    summary: 'Ops snapshot (`system.worker_status`, `system.queue_metrics`)',
    description:
      'Returns the latest 25 `WorkerStatus` rows by `lastHeartbeat` desc and 25 `QueueMetric` rows by `recordedAt` desc (scalar fields only). Requires ingest DB URL.',
  })
  snapshot() {
    return this.opsSnapshotService.snapshot();
  }
}

@ApiTags('system')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ANALYST', 'OPS', 'ADMIN')
@Controller('system/audit-logs')
export class SystemAuditLogsController {
  constructor(private readonly auditLogService: AuditLogService) {}

  @Get()
  @ApiOperation({
    summary: 'System audit logs (`system.audit_logs`)',
    description:
      'Returns `system.audit_logs` rows ordered by `createdAt` desc. `limit` is clamped [1, 200] (default 50); at most 100 rows per request. Optional `action` filters with case-insensitive substring match.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Requested page size (default 50, min 1, max 200; response capped at 100 rows).',
    example: 50,
  })
  @ApiQuery({
    name: 'action',
    required: false,
    type: String,
    description: 'Optional case-insensitive substring filter on `action`.',
  })
  list(
    @Query('limit') limitRaw?: string,
    @Query('action') actionRaw?: string,
  ) {
    const limit = parseLimit(limitRaw);
    const action =
      actionRaw != null && String(actionRaw).trim() !== ''
        ? String(actionRaw).trim()
        : undefined;
    return this.auditLogService.list(limit, action);
  }
}

@ApiTags('system')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ANALYST', 'OPS', 'ADMIN')
@Controller('system/failed-jobs')
export class SystemFailedJobsController {
  constructor(
    private readonly failedJobService: FailedJobService,
    private readonly failedJobReplayService: FailedJobReplayService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'System failed jobs (`system.failed_jobs`)',
    description:
      'Returns `system.failed_jobs` rows (BullMQ-style terminal failures). `limit` is clamped [1, 200] (default 50); at most 100 rows per request. Optional `queueName` filters by exact queue name. `orderBy`=`desc` (default) or `asc` sorts by `createdAt`.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Requested page size (default 50, min 1, max 200; response capped at 100 rows).',
    example: 50,
  })
  @ApiQuery({
    name: 'queueName',
    required: false,
    type: String,
    description: 'Optional exact match on `queueName`.',
  })
  @ApiQuery({
    name: 'orderBy',
    required: false,
    enum: ['desc', 'asc', 'newest', 'oldest'],
    description:
      'Sort by `createdAt`: `desc` / `newest` (default) or `asc` / `oldest`.',
  })
  list(
    @TenantId() tenantId: string,
    @Query('limit') limitRaw?: string,
    @Query('queueName') queueNameRaw?: string,
    @Query('orderBy') orderByRaw?: string,
  ) {
    const limit = parseLimit(limitRaw);
    const queueName =
      queueNameRaw != null && String(queueNameRaw).trim() !== ''
        ? String(queueNameRaw).trim()
        : undefined;
    const order = parseFailedJobOrder(orderByRaw);
    return this.failedJobService.list(limit, queueName, order, tenantId);
  }

  @Post(':id/replay')
  @HttpCode(200)
  @Roles('OPS', 'ADMIN')
  @ApiOperation({
    summary: 'Replay a terminal failed ingest job (BullMQ)',
    description:
      'Loads `system.failed_jobs` by UUID, sanitizes payload, and re-enqueues to the same Bull queue name. Requires `DATABASE_URL`/`INGEST_DATABASE_URL` and `REDIS_URL`/`BULLMQ_REDIS_URL`. Master/child/retry queues only.',
  })
  replay(@Param('id', ParseUUIDPipe) id: string, @TenantId() tenantId: string) {
    return this.failedJobReplayService.replay(id, tenantId);
  }
}
