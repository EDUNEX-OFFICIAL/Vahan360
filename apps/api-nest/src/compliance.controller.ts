import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ApiOperation, ApiProduces, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Roles } from './auth/roles.decorator';
import { RolesGuard } from './auth/roles.guard';
import { ComplianceService } from './compliance.service';

@ApiTags('compliance')
@UseGuards(RolesGuard)
@Roles('USER', 'ADMIN')
@Controller('compliance')
export class ComplianceController {
  constructor(private readonly complianceService: ComplianceService) {}

  @Get('summary/export.csv')
  @ApiOperation({
    summary:
      'Streaming CSV export for the compliance summary slice (same filters as JSON summary)',
  })
  @ApiProduces('text/csv')
  @ApiQuery({
    name: 'district',
    required: false,
    description:
      'Backward-compatible name: substring match on `vehicleRegNo` (case-insensitive), not geography.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Max rows to stream (1–5000; default 500)',
  })
  @ApiQuery({
    name: 'from',
    required: false,
    description: 'Optional inclusive lower bound ISO date on row `updatedAt`.',
  })
  @ApiQuery({
    name: 'to',
    required: false,
    description: 'Optional inclusive upper bound ISO date on row `updatedAt`.',
  })
  async exportSummaryCsv(
    @Res() res: Response,
    @Query('district') district?: string,
    @Query('limit') limit?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<void> {
    await this.complianceService.writeSummaryCsvStream(
      res,
      limit,
      district,
      from,
      to,
    );
  }

  @Get('summary')
  @ApiOperation({ summary: 'Processed vehicle compliance summaries (paginated slice)' })
  @ApiQuery({
    name: 'district',
    required: false,
    description:
      'Backward-compatible name: substring match on `vehicleRegNo` (case-insensitive), not geography.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Requested max rows (1–200; Prisma take capped at 100, default 50)',
  })
  @ApiQuery({
    name: 'from',
    required: false,
    description: 'Optional inclusive lower bound ISO date on row `updatedAt`.',
  })
  @ApiQuery({
    name: 'to',
    required: false,
    description: 'Optional inclusive upper bound ISO date on row `updatedAt`.',
  })
  getSummary(
    @Query('district') district?: string,
    @Query('limit') limit?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.complianceService.getSummary(limit, district, from, to);
  }
}
