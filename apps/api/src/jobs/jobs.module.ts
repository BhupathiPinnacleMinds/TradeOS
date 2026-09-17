import { Module } from '@nestjs/common';
import { CustomerCommunicationsModule } from '../communications/communications.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';

@Module({
  controllers: [JobsController],
  exports: [JobsService],
  imports: [CustomerCommunicationsModule, NotificationsModule],
  providers: [JobsService],
})
export class JobsModule {}
