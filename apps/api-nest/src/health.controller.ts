import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from './auth/public.decorator';

@ApiTags('health')
@Controller('health')
export class HealthController {
  @Public()
  @Get()
  @ApiOperation({ summary: 'Liveness — returns status and timestamp' })
  getHealth() {
    return {
      status: 'ok',
      service: 'vahan360-api-nest',
      ts: new Date().toISOString(),
    };
  }
}
