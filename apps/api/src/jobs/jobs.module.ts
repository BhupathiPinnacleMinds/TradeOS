import { Module } from '@nestjs/common';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';

@Module({
  controllers: [JobsController],
  exports: [JobsService],
  providers: [JobsService],
})
export class JobsModule {}
