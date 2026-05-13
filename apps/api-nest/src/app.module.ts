import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { TenantGuard } from './auth/tenant.guard';
import { HealthController } from './health.controller';
import { ControlModule } from './control.module';
import { RbacModule } from './rbac.module';
import { VehicleModule } from './vehicle.module';
import { ComplianceModule } from './compliance.module';
import { TripsModule } from './trips.module';
import { ConsignersModule } from './consigners.module';
import { DistrictsModule } from './districts.module';
import { SelectorsModule } from './selectors.module';
import { PermitModule } from './permit.module';
import { InsuranceModule } from './insurance.module';
import { IngestRawModule } from './ingest-raw.module';

@Module({
  imports: [
    AuthModule,
    ControlModule,
    RbacModule,
    VehicleModule,
    ComplianceModule,
    TripsModule,
    ConsignersModule,
    DistrictsModule,
    SelectorsModule,
    PermitModule,
    InsuranceModule,
    IngestRawModule,
  ],
  controllers: [HealthController],
  providers: [
    // Global JWT guard — applies to every controller/route by default.
    // Set DISABLE_AUTH=true in .env for local dev without a live DB.
    // Mark individual handlers/controllers with @Public() to skip auth.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
  ],
})
export class AppModule {}
