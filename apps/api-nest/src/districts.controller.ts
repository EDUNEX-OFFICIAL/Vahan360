import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Roles } from './auth/roles.decorator';
import { RolesGuard } from './auth/roles.guard';
import { DistrictsService } from './districts.service';

@ApiTags('districts')
@UseGuards(RolesGuard)
@Roles('USER', 'ADMIN')
@Controller('districts')
export class DistrictsController {
  constructor(private readonly districtsService: DistrictsService) {}

  @Get('summary')
  @ApiOperation({ summary: 'Processed district summaries (paginated slice)' })
  @ApiQuery({
    name: 'district',
    required: false,
    description: 'Substring match against `district` identifier (case-insensitive).',
  })
  @ApiQuery({
    name: 'from',
    required: false,
    description: 'Inclusive lower ISO date bound on row `updatedAt`.',
  })
  @ApiQuery({
    name: 'to',
    required: false,
    description: 'Inclusive upper ISO date bound on row `updatedAt`.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Max rows (capped at 100, default 20)',
  })
  getSummary(
    @Query('district') district?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
  ) {
    return this.districtsService.getSummary(limit, district, from, to);
  }
}
