import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
  provider?: string;
  providerMessageId?: string;
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
    return Promise.resolve({
      provider: `local-${delivery.channel.toLowerCase()}`,
      status: 'SENT',
    });
  }
}

export class RoutedCustomerCommunicationProvider implements CustomerCommunicationProvider {
  constructor(
    private readonly emailProvider: CustomerChannelProvider,
    private readonly smsProvider: CustomerChannelProvider,
  ) {}

  send(delivery: CustomerCommunicationDelivery) {
    return delivery.channel === 'EMAIL'
      ? this.emailProvider.send(delivery)
      : this.smsProvider.send(delivery);
  }
}

export interface CustomerChannelProvider {
  readonly name: string;
  send(
    delivery: CustomerCommunicationDelivery,
  ): Promise<CustomerCommunicationDeliveryResult>;
}

export class ResendCustomerEmailProvider implements CustomerChannelProvider {
  readonly name = 'resend';

  constructor(
    private readonly apiKey: string,
    private readonly fromName: string,
    private readonly fromAddress: string,
  ) {}

  async send(delivery: CustomerCommunicationDelivery) {
    if (!delivery.recipient) {
      return failed(this.name, 'COMMUNICATION_RECIPIENT_MISSING');
    }
    try {
      const response = await fetch('https://api.resend.com/emails', {
        body: JSON.stringify({
          from: `${this.fromName} <${this.fromAddress}>`,
          html: textToHtml(delivery.message),
          subject:
            delivery.subject ??
            `${delivery.type.replaceAll('_', ' ').toLowerCase()} from ${this.fromName}`,
          text: delivery.message,
          to: delivery.recipient,
        }),
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        method: 'POST',
      });
      const body = (await response.json().catch(() => ({}))) as {
        id?: string;
        message?: string;
      };
      if (!response.ok) {
        return failed(this.name, safeProviderFailure(body.message, response));
      }
      return {
        provider: this.name,
        providerMessageId: body.id,
        status: 'SENT' as const,
      };
    } catch (error) {
      return failed(this.name, error);
    }
  }
}

export class TwilioCustomerSmsProvider implements CustomerChannelProvider {
  readonly name = 'twilio';

  constructor(
    private readonly accountSid: string,
    private readonly authToken: string,
    private readonly fromNumber: string,
  ) {}

  async send(delivery: CustomerCommunicationDelivery) {
    const to = normaliseAustralianMobileForSms(delivery.recipient);
    if (!to) {
      return failed(this.name, 'COMMUNICATION_INVALID_SMS_RECIPIENT');
    }
    try {
      const response = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(
          this.accountSid,
        )}/Messages.json`,
        {
          body: new URLSearchParams({
            Body: delivery.message,
            From: this.fromNumber,
            To: to,
          }),
          headers: {
            Authorization: `Basic ${Buffer.from(
              `${this.accountSid}:${this.authToken}`,
            ).toString('base64')}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          method: 'POST',
        },
      );
      const body = (await response.json().catch(() => ({}))) as {
        code?: number;
        message?: string;
        sid?: string;
      };
      if (!response.ok) {
        return failed(this.name, safeProviderFailure(body.message, response));
      }
      return {
        provider: this.name,
        providerMessageId: body.sid,
        status: 'SENT' as const,
      };
    } catch (error) {
      return failed(this.name, error);
    }
  }
}

export function createCustomerCommunicationProvider(
  config: ConfigService,
): CustomerCommunicationProvider {
  const emailProvider = config.get<string>('CUSTOMER_EMAIL_PROVIDER', 'local');
  const smsProvider = config.get<string>('CUSTOMER_SMS_PROVIDER', 'local');
  return new RoutedCustomerCommunicationProvider(
    emailProvider === 'resend'
      ? new ResendCustomerEmailProvider(
          required(config, 'RESEND_API_KEY'),
          config.get<string>('EMAIL_FROM_NAME', 'TradieOS'),
          required(config, 'EMAIL_FROM_ADDRESS'),
        )
      : new LocalChannelProvider('local-email'),
    smsProvider === 'twilio'
      ? new TwilioCustomerSmsProvider(
          required(config, 'TWILIO_ACCOUNT_SID'),
          required(config, 'TWILIO_AUTH_TOKEN'),
          required(config, 'TWILIO_MESSAGING_FROM'),
        )
      : new LocalChannelProvider('local-sms'),
  );
}

class LocalChannelProvider implements CustomerChannelProvider {
  constructor(readonly name: string) {}

  send(delivery: CustomerCommunicationDelivery) {
    return new LocalCustomerCommunicationProvider().send(delivery).then(() => ({
      provider: this.name,
      status: 'SENT' as const,
    }));
  }
}

export const customerCommunicationProvider = {
  inject: [ConfigService],
  provide: CustomerCommunicationProvider,
  useFactory: createCustomerCommunicationProvider,
};

function required(config: ConfigService, key: string) {
  const value = config.get<string>(key);
  if (!value?.trim()) {
    throw new Error(`${key} is required for customer communication delivery.`);
  }
  return value.trim();
}

function failed(provider: string, reason: unknown) {
  const rawReason =
    reason instanceof Error
      ? reason.message
      : typeof reason === 'string'
        ? reason
        : 'COMMUNICATION_SEND_FAILED';

  return {
    failureReason: safeFailureReason(rawReason),
    provider,
    status: 'FAILED' as const,
  };
}

function safeProviderFailure(message: string | undefined, response: Response) {
  return (
    message ||
    `PROVIDER_REQUEST_FAILED_${response.status}` ||
    'COMMUNICATION_SEND_FAILED'
  );
}

function safeFailureReason(value: string) {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/Basic\s+[A-Za-z0-9._~+/=-]+/gi, 'Basic [redacted]')
    .slice(0, 240);
}

function textToHtml(value: string) {
  return `<p>${escapeHtml(value).replaceAll('\n', '<br />')}</p>`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function normaliseAustralianMobileForSms(value: string) {
  const digits = value.trim().replace(/\D/g, '');
  const local =
    digits.startsWith('614') && digits.length === 11
      ? `0${digits.slice(2)}`
      : digits;
  if (!/^04\d{8}$/.test(local)) return null;
  return `+61${local.slice(1)}`;
}
