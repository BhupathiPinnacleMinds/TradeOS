import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AiModule } from './ai/ai.module';
import { AppointmentsModule } from './appointments/appointments.module';
import { AuthModule } from './auth/auth.module';
import { BusinessesModule } from './businesses/businesses.module';
import { CustomersModule } from './customers/customers.module';
import { CustomerCommunicationsModule } from './communications/communications.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { DocumentsModule } from './documents/documents.module';
import { HealthModule } from './health/health.module';
import { IdempotencyModule } from './idempotency/idempotency.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { InvoicesModule } from './invoices/invoices.module';
import { JobsModule } from './jobs/jobs.module';
import { MembersModule } from './members/members.module';
import { MediaModule } from './media/media.module';
import { MessagesModule } from './messages/messages.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ObservabilityModule } from './observability/observability.module';
import { PaymentsModule } from './payments/payments.module';
import { PrismaModule } from './prisma/prisma.module';
import { QuotesModule } from './quotes/quotes.module';
import { ReportsModule } from './reports/reports.module';
import { validateEnvironment } from './config/app-config';

@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      envFilePath: ['apps/api/.env', '.env'],
      isGlobal: true,
      validate: validateEnvironment,
    }),
    ObservabilityModule,
    PrismaModule,
    IdempotencyModule,
    AuthModule,
    HealthModule,
    BusinessesModule,
    MembersModule,
    MediaModule,
    CustomerCommunicationsModule,
    CustomersModule,
    JobsModule,
    AppointmentsModule,
    QuotesModule,
    InvoicesModule,
    PaymentsModule,
    MessagesModule,
    AiModule,
    NotificationsModule,
    DashboardModule,
    DocumentsModule,
    ReportsModule,
    IntegrationsModule,
  ],
})
export class AppModule {}
