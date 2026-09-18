import { Module } from '@nestjs/common';
import { CustomerCommunicationsModule } from '../communications/communications.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AppointmentAttentionModule } from './appointment-attention.module';
import { AppointmentNotificationsService } from './appointment-notifications.service';
import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';
import { SchedulingService } from './scheduling.service';

@Module({
  controllers: [AppointmentsController],
  imports: [
    PrismaModule,
    CustomerCommunicationsModule,
    NotificationsModule,
    AppointmentAttentionModule,
  ],
  providers: [
    AppointmentNotificationsService,
    AppointmentsService,
    SchedulingService,
  ],
  exports: [AppointmentsService, SchedulingService],
})
export class AppointmentsModule {}
