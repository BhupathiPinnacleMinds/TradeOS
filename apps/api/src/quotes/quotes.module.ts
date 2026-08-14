import { Module } from '@nestjs/common';
import { CustomerCommunicationsModule } from '../communications/communications.module';
import { MediaModule } from '../media/media.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PublicQuotesController } from './public-quotes.controller';
import { QuotesController } from './quotes.controller';
import { QuotesService } from './quotes.service';

@Module({
  controllers: [QuotesController, PublicQuotesController],
  imports: [PrismaModule, MediaModule, CustomerCommunicationsModule],
  providers: [QuotesService],
})
export class QuotesModule {}
