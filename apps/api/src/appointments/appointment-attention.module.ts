import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AppointmentAttentionService } from './appointment-attention.service';

@Module({
  exports: [AppointmentAttentionService],
  imports: [PrismaModule],
  providers: [AppointmentAttentionService],
})
export class AppointmentAttentionModule {}
