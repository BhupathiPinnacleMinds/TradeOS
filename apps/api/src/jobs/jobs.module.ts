import { Module } from '@nestjs/common';
import { AppointmentAttentionModule } from '../appointments/appointment-attention.module';
import { CustomerCommunicationsModule } from '../communications/communications.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';

@Module({
  controllers: [JobsController],
  exports: [JobsService],
  imports: [
    CustomerCommunicationsModule,
    NotificationsModule,
    AppointmentAttentionModule,
  ],
  providers: [JobsService],
})
export class JobsModule {}
