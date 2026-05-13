import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Roles } from './auth/roles.decorator';
import { RolesGuard } from './auth/roles.guard';
import { ConsignersService } from './consigners.service';

@ApiTags('consigners')
@UseGuards(RolesGuard)
@Roles('USER', 'ADMIN')
@Controller('consigners')
export class ConsignersController {
  constructor(private readonly consignersService: ConsignersService) {}

  @Get('summary')
  @ApiOperation({ summary: 'Processed consigner summaries (paginated slice)' })
  @ApiQuery({
    name: 'consignerKey',
    required: false,
    description: 'Substring filter on canonical `consignerKey` column.',
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
    @Query('consignerKey') key?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
  ) {
    return this.consignersService.getSummary(limit, key, from, to);
  }
}
