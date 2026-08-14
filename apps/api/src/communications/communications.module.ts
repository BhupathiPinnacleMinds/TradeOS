import { Module } from '@nestjs/common';
import { CustomerCommunicationsController } from './communications.controller';
import {
  CustomerCommunicationsService,
  customerCommunicationProvider,
} from './communications.service';

@Module({
  controllers: [CustomerCommunicationsController],
  exports: [CustomerCommunicationsService],
  providers: [CustomerCommunicationsService, customerCommunicationProvider],
})
export class CustomerCommunicationsModule {}
