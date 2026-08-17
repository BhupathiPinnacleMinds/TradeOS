import { Module } from '@nestjs/common';
import { AppointmentsModule } from '../appointments/appointments.module';
import { CustomerCommunicationsModule } from '../communications/communications.module';
import { CustomersModule } from '../customers/customers.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { JobsModule } from '../jobs/jobs.module';
import { PrismaModule } from '../prisma/prisma.module';
import { QuotesModule } from '../quotes/quotes.module';
import { AiController } from './ai.controller';
import { AiProvider, ToriLocalAiProvider } from './ai-provider';
import { AiService } from './ai.service';

@Module({
  controllers: [AiController],
  imports: [
    PrismaModule,
    AppointmentsModule,
    CustomerCommunicationsModule,
    CustomersModule,
    JobsModule,
    QuotesModule,
    InvoicesModule,
  ],
  providers: [
    AiService,
    {
      provide: AiProvider,
      useClass: ToriLocalAiProvider,
    },
  ],
})
export class AiModule {}
