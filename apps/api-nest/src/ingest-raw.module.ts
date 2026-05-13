import { Module } from '@nestjs/common';
import {
  IngestOpsController,
  IngestRawChallanController,
  IngestRawController,
  IngestRawFitnessController,
  IngestRawVehicleController,
  IngestScrapeJobsController,
  SystemAuditLogsController,
  SystemFailedJobsController,
} from './ingest-raw.controller';
import { RawChallanService } from './raw-challan.service';
import { RawKhananService } from './raw-khanan.service';
import { RawFitnessService } from './raw-fitness.service';
import { RawVehicleService } from './raw-vehicle.service';
import { OpsSnapshotService } from './ops-snapshot.service';
import { ScrapeJobService } from './scrape-job.service';
import { AuditLogService } from './audit-log.service';
import { FailedJobReplayService } from './failed-job-replay.service';
import { FailedJobService } from './failed-job.service';

@Module({
  controllers: [
    IngestRawController,
    IngestRawVehicleController,
    IngestRawFitnessController,
    IngestRawChallanController,
    IngestScrapeJobsController,
    IngestOpsController,
    SystemAuditLogsController,
    SystemFailedJobsController,
  ],
  providers: [
    RawKhananService,
    RawVehicleService,
    RawFitnessService,
    RawChallanService,
    ScrapeJobService,
    OpsSnapshotService,
    AuditLogService,
    FailedJobService,
    FailedJobReplayService,
  ],
})
export class IngestRawModule {}
