import { Injectable } from '@nestjs/common';
import type { CustomerCommunicationChannel } from '@tradieos/shared';

export type CustomerCommunicationDelivery = {
  businessId: string;
  channel: CustomerCommunicationChannel;
  communicationId: string;
  entityReference: string;
  message: string;
  recipient: string;
  subject?: string | null;
  type: string;
};

export type CustomerCommunicationDeliveryResult = {
  status: 'SENT' | 'FAILED';
  failureReason?: string;
};

export abstract class CustomerCommunicationProvider {
  abstract send(
    delivery: CustomerCommunicationDelivery,
  ): Promise<CustomerCommunicationDeliveryResult>;
}

@Injectable()
export class LocalCustomerCommunicationProvider implements CustomerCommunicationProvider {
  send(
    delivery: CustomerCommunicationDelivery,
  ): Promise<CustomerCommunicationDeliveryResult> {
    const safePreview = delivery.message.replace(/\s+/g, ' ').slice(0, 180);
    console.info('[TradieOS customer-communication:LOCAL]', {
      channel: delivery.channel,
      communicationId: delivery.communicationId,
      entityReference: delivery.entityReference,
      recipient: delivery.recipient,
      safePreview,
      subject: delivery.subject ?? null,
      timestamp: new Date().toISOString(),
      type: delivery.type,
    });
    return Promise.resolve({ status: 'SENT' });
  }
}
