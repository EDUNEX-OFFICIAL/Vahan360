import { Module } from '@nestjs/common';
import { SelectorsController } from './selectors.controller';

@Module({
  controllers: [SelectorsController],
})
export class SelectorsModule {}
