import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CustomerCommunicationsModule } from '../communications/communications.module';
import { MediaModule } from '../media/media.module';
import { PrismaModule } from '../prisma/prisma.module';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { PublicInvoicesController } from './public-invoices.controller';

@Module({
  controllers: [InvoicesController, PublicInvoicesController],
  imports: [
    PrismaModule,
    ConfigModule,
    MediaModule,
    CustomerCommunicationsModule,
  ],
  providers: [InvoicesService],
  exports: [InvoicesService],
})
export class InvoicesModule {}
