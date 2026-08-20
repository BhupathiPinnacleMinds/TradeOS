import { Module } from '@nestjs/common';
import { CustomerCommunicationsController } from './communications.controller';
import { CustomerCommunicationsService } from './communications.service';
import { customerCommunicationProvider } from './customer-communication.provider';
import { CustomerCommunicationWorker } from './customer-communication.worker';

@Module({
  controllers: [CustomerCommunicationsController],
  exports: [CustomerCommunicationsService],
  providers: [
    CustomerCommunicationsService,
    CustomerCommunicationWorker,
    customerCommunicationProvider,
  ],
})
export class CustomerCommunicationsModule {}
