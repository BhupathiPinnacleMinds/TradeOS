import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';
import { MemberLeaveController } from './member-leave.controller';
import { MemberLeaveService } from './member-leave.service';

@Module({
  controllers: [MemberLeaveController],
  imports: [NotificationsModule, PrismaModule],
  providers: [MemberLeaveService],
})
export class MemberLeaveModule {}
