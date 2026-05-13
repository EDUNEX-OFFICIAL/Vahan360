import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class VehicleTimelineQueryDto {
  @ApiPropertyOptional({
    minimum: 1,
    maximum: 200,
    description: 'Max events to return when implemented (default 50)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
