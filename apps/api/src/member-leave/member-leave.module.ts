import { Module } from '@nestjs/common';
import { AppointmentAttentionModule } from '../appointments/appointment-attention.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';
import { MemberLeaveController } from './member-leave.controller';
import { MemberLeaveService } from './member-leave.service';

@Module({
  controllers: [MemberLeaveController],
  imports: [NotificationsModule, PrismaModule, AppointmentAttentionModule],
  providers: [MemberLeaveService],
})
export class MemberLeaveModule {}
