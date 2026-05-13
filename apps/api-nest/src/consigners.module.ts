import { Module } from '@nestjs/common';
import { ConsignersController } from './consigners.controller';
import { ConsignersService } from './consigners.service';

@Module({
  controllers: [ConsignersController],
  providers: [ConsignersService],
})
export class ConsignersModule {}
