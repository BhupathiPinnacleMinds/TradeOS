import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';
import { MemberShiftsController } from './member-shifts.controller';
import { MemberShiftsService } from './member-shifts.service';

@Module({
  controllers: [MemberShiftsController],
  exports: [MemberShiftsService],
  imports: [PrismaModule, NotificationsModule],
  providers: [MemberShiftsService],
})
export class MemberShiftsModule {}
