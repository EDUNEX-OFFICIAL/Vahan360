import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Roles } from './auth/roles.decorator';
import { RolesGuard } from './auth/roles.guard';
import { TripsService } from './trips.service';

@ApiTags('trips')
@UseGuards(RolesGuard)
@Roles('USER', 'ADMIN')
@Controller('trips')
export class TripsController {
  constructor(private readonly tripsService: TripsService) {}

  @Get('summary')
  @ApiOperation({ summary: 'Processed vehicle trip summaries (paginated slice)' })
  @ApiQuery({
    name: 'from',
    required: false,
    description: 'Inclusive lower ISO date bound on summary `updatedAt`.',
  })
  @ApiQuery({
    name: 'to',
    required: false,
    description: 'Inclusive upper ISO date bound on summary `updatedAt`.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Max rows (capped at 100, default 20)',
  })
  @ApiQuery({
    name: 'q',
    required: false,
    description: 'Substring match on `vehicleRegNo` (case-insensitive).',
  })
  getSummary(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
    @Query('q') q?: string,
  ) {
    return this.tripsService.getSummary(limit, from, to, q);
  }
}
