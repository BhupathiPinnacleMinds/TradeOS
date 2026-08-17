import { HttpException } from '@nestjs/common';
import type { AuthenticatedUser } from '@tradieos/shared';
import { CustomerCommunicationsService } from './communications.service';

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

const owner: AuthenticatedUser = {
  businessId: 'business-1',
  email: 'owner@example.com',
  id: 'owner-1',
  role: 'OWNER',
};

const readOnly: AuthenticatedUser = {
  businessId: 'business-1',
  email: 'readonly@example.com',
  id: 'readonly-1',
  role: 'READ_ONLY',
};

function makeDate(value: string) {
  return new Date(value);
}

function business() {
  return {
    email: 'office@tradie.test',
    name: 'Demo Tradie Co',
    phone: '0400000000',
    timezone: 'Australia/Sydney',
  };
}

function customer(overrides: Record<string, unknown> = {}) {
  return {
    communicationPreference: {
      emailEnabled: true,
      smsEnabled: true,
    },
    displayName: 'Mohith',
    email: 'mohith@example.test',
    id: 'customer-1',
    phone: '0414303343',
    ...overrides,
  };
}

function appointment(overrides: Record<string, unknown> = {}) {
  return {
    addressLine1: '16 Coffey Street',
    addressLine2: null,
    appointmentType: 'INSPECTION',
    id: 'appointment-1',
    job: {
      customer: customer(),
      customerId: 'customer-1',
      title: 'Outdoor leak',
    },
    jobId: 'job-1',
    postcode: '3029',
    scheduledEnd: makeDate('2026-08-13T06:07:00.000Z'),
    scheduledStart: makeDate('2026-08-13T04:07:00.000Z'),
    state: 'VIC',
    suburb: 'Tarneit',
    ...overrides,
  };
}

function quote(overrides: Record<string, unknown> = {}) {
  return {
    acceptedAt: null,
    archivedAt: null,
    businessId: 'business-1',
    cancelledAt: null,
    customer: customer(),
    declinedAt: null,
    expiredAt: null,
    expiryDate: makeDate('2026-08-24T04:00:00.000Z'),
    id: 'quote-1',
    quoteNumber: 'Q-2026-000001',
    sentAt: makeDate('2026-08-14T04:00:00.000Z'),
    status: 'SENT',
    totalCents: 36300,
    version: 1,
    ...overrides,
  };
}

function invoice(overrides: Record<string, unknown> = {}) {
  return {
    amountPaidCents: 0,
    balanceDueCents: 88000,
    businessId: 'business-1',
    customer: customer(),
    dueDate: makeDate('2026-08-20T04:00:00.000Z'),
    id: 'invoice-1',
    invoiceNumber: 'INV-2026-000001',
    status: 'SENT',
    totalCents: 88000,
    version: 1,
    ...overrides,
  };
}

function payment(overrides: Record<string, unknown> = {}) {
  return {
    amountCents: 30000,
    businessId: 'business-1',
    id: 'payment-1',
    invoice: invoice({
      amountPaidCents: 30000,
      balanceDueCents: 58000,
      status: 'PARTIALLY_PAID',
    }),
    invoiceId: 'invoice-1',
    method: 'BANK_TRANSFER',
    receivedAt: makeDate('2026-08-14T04:30:00.000Z'),
    ...overrides,
  };
}

type CommunicationRecord = Record<string, unknown> & {
  businessId: string;
  createdAt: Date;
  id: string;
  idempotencyKey: string;
  relatedAppointmentId?: string | null;
  relatedInvoiceId?: string | null;
  relatedQuoteId?: string | null;
  status: string;
  type: string;
  updatedAt: Date;
};

type ListArgs = {
  orderBy?: Array<Record<string, string>>;
  take?: number;
  where?: {
    businessId?: string;
    customerId?: string;
    relatedAppointmentId?: string;
    relatedInvoiceId?: string;
    relatedQuoteId?: string;
    scheduledFor?: {
      lte: Date;
    };
    status?: string;
    type?: string | { in: string[] };
  };
};

type UniqueArgs = {
  where: {
    businessId_idempotencyKey: {
      businessId: string;
      idempotencyKey: string;
    };
  };
};

type UpdateArgs = {
  data: Record<string, unknown>;
  where: {
    id: string;
  };
};

type UpdateManyArgs = {
  data: Record<string, unknown>;
  where: {
    businessId: string;
    relatedAppointmentId?: string;
    relatedInvoiceId?: string;
    relatedQuoteId?: string;
    status: string;
    type: {
      in: string[];
    };
  };
};

type UpsertArgs = {
  create: Record<string, unknown> & {
    businessId: string;
    failedAt?: Date | null;
    idempotencyKey: string;
    status: string;
    type: string;
  };
  update: Record<string, unknown>;
  where: {
    businessId_idempotencyKey: {
      businessId: string;
      idempotencyKey: string;
    };
  };
};

function createHarness(
  settingsOverrides: Partial<Record<string, boolean | number | string>> = {},
) {
  const records: CommunicationRecord[] = [];
  const provider = { send: jest.fn().mockResolvedValue({ status: 'SENT' }) };
  const now = makeDate('2026-08-12T00:00:00.000Z');
  let currentQuote = quote();
  let currentInvoice = invoice();
  let currentPayment = payment();
  let nextId = 1;
  const prisma = {
    business: {
      findUnique: jest.fn().mockResolvedValue(business()),
    },
    businessCommunicationSettings: {
      upsert: jest.fn().mockResolvedValue({
        appointmentConfirmationsEnabled: true,
        appointmentReminderLeadMinutes: 1440,
        appointmentRemindersEnabled: true,
        businessId: 'business-1',
        invoiceDueSoonLeadMinutes: 4320,
        invoiceDueSoonRemindersEnabled: true,
        invoiceOverdueDelayMinutes: 1440,
        invoiceOverdueRemindersEnabled: true,
        paymentConfirmationsEnabled: true,
        quoteFollowUpDelayMinutes: 4320,
        quoteFollowUpsEnabled: true,
        ...settingsOverrides,
      }),
    },
    businessMember: {
      findMany: jest.fn().mockResolvedValue([{ userId: 'owner-1' }]),
    },
    customer: {
      findFirst: jest.fn().mockResolvedValue(customer()),
    },
    customerCommunication: {
      findFirst: jest.fn(),
      findMany: jest.fn((args?: ListArgs) =>
        Promise.resolve(
          records
            .filter(
              (record) =>
                (!args?.where?.businessId ||
                  record.businessId === args.where.businessId) &&
                (!args?.where?.customerId ||
                  record.customerId === args.where.customerId) &&
                (!args?.where?.relatedAppointmentId ||
                  record.relatedAppointmentId ===
                    args.where.relatedAppointmentId) &&
                (!args?.where?.relatedQuoteId ||
                  record.relatedQuoteId === args.where.relatedQuoteId) &&
                (!args?.where?.relatedInvoiceId ||
                  record.relatedInvoiceId === args.where.relatedInvoiceId) &&
                (!args?.where?.scheduledFor?.lte ||
                  (record.scheduledFor instanceof Date &&
                    record.scheduledFor.getTime() <=
                      args.where.scheduledFor.lte.getTime())) &&
                (!args?.where?.status || record.status === args.where.status),
            )
            .filter(
              (record) =>
                !args?.where?.type ||
                (typeof args.where.type === 'string'
                  ? record.type === args.where.type
                  : args.where.type.in.includes(record.type)),
            )
            .sort((left, right) => {
              const createdAtDelta =
                Number(right.createdAt) - Number(left.createdAt);
              if (createdAtDelta !== 0) return createdAtDelta;
              return String(right.id).localeCompare(String(left.id));
            })
            .slice(0, args?.take ?? 25),
        ),
      ),
      findUnique: jest.fn((args: UniqueArgs) => {
        const key = args.where.businessId_idempotencyKey;
        return Promise.resolve(
          records.find(
            (record) =>
              record.businessId === key.businessId &&
              record.idempotencyKey === key.idempotencyKey,
          ) ?? null,
        );
      }),
      update: jest.fn((args: UpdateArgs) => {
        const record = records.find((item) => item.id === args.where.id);
        Object.assign(record ?? {}, args.data, { updatedAt: now });
        return Promise.resolve(record);
      }),
      updateMany: jest.fn((args: UpdateManyArgs) => {
        let count = 0;
        records.forEach((record) => {
          if (
            record.businessId === args.where.businessId &&
            record.status === args.where.status &&
            args.where.type.in.includes(record.type) &&
            (!args.where.relatedAppointmentId ||
              record.relatedAppointmentId ===
                args.where.relatedAppointmentId) &&
            (!args.where.relatedQuoteId ||
              record.relatedQuoteId === args.where.relatedQuoteId) &&
            (!args.where.relatedInvoiceId ||
              record.relatedInvoiceId === args.where.relatedInvoiceId)
          ) {
            Object.assign(record, args.data, { updatedAt: now });
            count += 1;
          }
        });
        return Promise.resolve({ count });
      }),
      upsert: jest.fn((args: UpsertArgs) => {
        const key = args.where.businessId_idempotencyKey;
        const existing = records.find(
          (record) =>
            record.businessId === key.businessId &&
            record.idempotencyKey === key.idempotencyKey,
        );
        if (existing) {
          Object.entries(args.update).forEach(([field, value]) => {
            if (value !== undefined) existing[field] = value;
          });
          existing.updatedAt = now;
          return Promise.resolve(existing);
        }
        const created = {
          ...args.create,
          cancelledAt: null,
          createdAt: now,
          failedAt: args.create.failedAt ?? null,
          id: `communication-${nextId++}`,
          sentAt: null,
          updatedAt: now,
        } as CommunicationRecord;
        records.push(created);
        return Promise.resolve(created);
      }),
    },
    customerCommunicationPreference: {
      upsert: jest.fn().mockResolvedValue({
        businessId: 'business-1',
        customerId: 'customer-1',
        emailEnabled: true,
        smsEnabled: true,
      }),
    },
    notification: {
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    quote: {
      findFirst: jest
        .fn()
        .mockImplementation(() => Promise.resolve(currentQuote)),
    },
    invoice: {
      findFirst: jest
        .fn()
        .mockImplementation(() => Promise.resolve(currentInvoice)),
    },
    invoicePayment: {
      findFirst: jest
        .fn()
        .mockImplementation(() => Promise.resolve(currentPayment)),
    },
  };
  return {
    prisma,
    provider,
    records,
    service: new CustomerCommunicationsService(prisma as never, provider),
    setQuote: (next: Record<string, unknown>) => {
      currentQuote = quote(next);
    },
    setInvoice: (next: Record<string, unknown>) => {
      currentInvoice = invoice(next);
    },
    setPayment: (next: Record<string, unknown>) => {
      currentPayment = payment(next);
    },
  };
}

describe('CustomerCommunicationsService', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('creates an appointment confirmation and schedules one reminder', async () => {
    const { provider, records, service, prisma } = createHarness();

    await service.appointmentCreated(prisma as never, owner, appointment());

    expect(records).toHaveLength(2);
    expect(records.map((record) => record.type)).toEqual([
      'APPOINTMENT_CONFIRMATION',
      'APPOINTMENT_REMINDER',
    ]);
    expect(records[0].status).toBe('SENT');
    expect(records[1].status).toBe('SCHEDULED');
    expect(provider.send).toHaveBeenCalledTimes(1);
  });

  it('uses SMS for a phone-only customer with default ANY preferences', async () => {
    const { provider, records, service, prisma } = createHarness();

    await service.appointmentCreated(
      prisma as never,
      owner,
      appointment({
        job: {
          customer: customer({
            communicationPreference: null,
            email: null,
            phone: '0414303232',
          }),
          customerId: 'customer-1',
          title: 'Electric box repair',
        },
      }),
    );

    expect(records).toHaveLength(2);
    expect(records.map((record) => record.channel)).toEqual(['SMS', 'SMS']);
    expect(records.map((record) => record.recipient)).toEqual([
      '0414303232',
      '0414303232',
    ]);
    expect(records.map((record) => record.failureReason)).toEqual([null, null]);
    expect(provider.send).toHaveBeenCalledTimes(1);
  });

  it('respects appointment communication settings being turned off', async () => {
    const { provider, records, service, prisma } = createHarness({
      appointmentConfirmationsEnabled: false,
      appointmentRemindersEnabled: false,
    });

    await service.appointmentCreated(prisma as never, owner, appointment());

    expect(records).toEqual([]);
    expect(provider.send).not.toHaveBeenCalled();
  });

  it('does not duplicate appointment confirmation or reminder records on retry', async () => {
    const { provider, records, service, prisma } = createHarness();

    await service.appointmentCreated(prisma as never, owner, appointment());
    await service.appointmentCreated(prisma as never, owner, appointment());

    expect(records).toHaveLength(2);
    expect(records.map((record) => record.type)).toEqual([
      'APPOINTMENT_CONFIRMATION',
      'APPOINTMENT_REMINDER',
    ]);
    expect(provider.send).toHaveBeenCalledTimes(1);
  });

  it('cancels and replaces a pending reminder when an appointment is rescheduled', async () => {
    const { records, service, prisma } = createHarness();
    await service.appointmentCreated(prisma as never, owner, appointment());

    await service.appointmentRescheduled(
      prisma as never,
      owner,
      appointment({
        scheduledEnd: makeDate('2026-08-14T06:07:00.000Z'),
        scheduledStart: makeDate('2026-08-14T04:07:00.000Z'),
      }),
    );

    expect(
      records.filter(
        (record) =>
          record.type === 'APPOINTMENT_REMINDER' &&
          record.status === 'CANCELLED',
      ),
    ).toHaveLength(1);
    expect(
      records.filter(
        (record) =>
          record.type === 'APPOINTMENT_REMINDER' &&
          record.status === 'SCHEDULED',
      ),
    ).toHaveLength(1);
  });

  it('cancels pending appointment reminders when an appointment is cancelled', async () => {
    const { records, service, prisma } = createHarness();
    await service.appointmentCreated(prisma as never, owner, appointment());

    await service.appointmentCancelled(prisma as never, owner, appointment());

    expect(
      records.filter(
        (record) =>
          record.type === 'APPOINTMENT_REMINDER' &&
          record.status === 'CANCELLED',
      ),
    ).toHaveLength(1);
    expect(
      records.filter((record) => record.type === 'APPOINTMENT_CANCELLED'),
    ).toHaveLength(1);
  });

  it('records missing recipient as failed without sending', async () => {
    const { provider, records, service, prisma } = createHarness();

    await service.appointmentCreated(
      prisma as never,
      owner,
      appointment({
        job: {
          customer: customer({ email: null, phone: null }),
          customerId: 'customer-1',
          title: 'Outdoor leak',
        },
      }),
    );

    expect(records[0].status).toBe('FAILED');
    expect(records[0].failureReason).toBe('COMMUNICATION_RECIPIENT_MISSING');
    expect(provider.send).not.toHaveBeenCalled();
  });

  it('creates quote sent history and schedules one follow-up from the quote sent time', async () => {
    const { provider, records, service } = createHarness();

    await service.quoteSent({
      businessId: owner.businessId,
      createdBy: owner.id,
      publicUrl: 'http://localhost:3000/public/quotes/demo-token',
      quoteId: 'quote-1',
    });

    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      relatedQuoteId: 'quote-1',
      status: 'SENT',
      type: 'QUOTE_SENT',
    });
    expect(records[1]).toMatchObject({
      relatedQuoteId: 'quote-1',
      status: 'SCHEDULED',
      type: 'QUOTE_FOLLOW_UP',
    });
    expect((records[1].scheduledFor as Date).toISOString()).toBe(
      '2026-08-17T04:00:00.000Z',
    );
    expect(provider.send).toHaveBeenCalledTimes(1);
  });

  it('keeps quote follow-up local wall-clock time across Sydney daylight saving', async () => {
    const { records, service, setQuote } = createHarness();
    setQuote({
      sentAt: makeDate('2026-10-03T04:00:00.000Z'),
    });

    await service.quoteSent({
      businessId: owner.businessId,
      createdBy: owner.id,
      publicUrl: 'http://localhost:3000/public/quotes/demo-token',
      quoteId: 'quote-1',
    });

    const followUp = records.find(
      (record) => record.type === 'QUOTE_FOLLOW_UP',
    );
    expect((followUp?.scheduledFor as Date).toISOString()).toBe(
      '2026-10-06T03:00:00.000Z',
    );
  });

  it('does not schedule quote follow-up when the setting is off', async () => {
    const { provider, records, service } = createHarness({
      quoteFollowUpsEnabled: false,
    });

    await service.quoteSent({
      businessId: owner.businessId,
      createdBy: owner.id,
      publicUrl: 'http://localhost:3000/public/quotes/demo-token',
      quoteId: 'quote-1',
    });

    expect(records.map((record) => record.type)).toEqual(['QUOTE_SENT']);
    expect(provider.send).toHaveBeenCalledTimes(1);
  });

  it('uses SMS for quote communications when the customer only has a phone', async () => {
    const { records, service, setQuote } = createHarness();
    setQuote({
      customer: customer({
        communicationPreference: null,
        email: null,
        phone: '0414303999',
      }),
    });

    await service.quoteSent({
      businessId: owner.businessId,
      createdBy: owner.id,
      publicUrl: 'http://localhost:3000/public/quotes/demo-token',
      quoteId: 'quote-1',
    });

    expect(records.map((record) => record.channel)).toEqual(['SMS', 'SMS']);
    expect(records.map((record) => record.recipient)).toEqual([
      '0414303999',
      '0414303999',
    ]);
  });

  it('respects customer quote communication preferences', async () => {
    const { records, service, setQuote } = createHarness();
    setQuote({
      customer: customer({
        communicationPreference: {
          emailEnabled: false,
          smsEnabled: true,
        },
        phone: '0414303888',
      }),
    });

    await service.quoteSent({
      businessId: owner.businessId,
      createdBy: owner.id,
      publicUrl: 'http://localhost:3000/public/quotes/demo-token',
      quoteId: 'quote-1',
    });

    expect(records.map((record) => record.channel)).toEqual(['SMS', 'SMS']);
    expect(records.map((record) => record.failureReason)).toEqual([null, null]);
  });

  it('does not duplicate quote sent or follow-up records on retry', async () => {
    const { provider, records, service } = createHarness();

    await service.quoteSent({
      businessId: owner.businessId,
      createdBy: owner.id,
      publicUrl: 'http://localhost:3000/public/quotes/demo-token',
      quoteId: 'quote-1',
    });
    await service.quoteSent({
      businessId: owner.businessId,
      createdBy: owner.id,
      publicUrl: 'http://localhost:3000/public/quotes/demo-token',
      quoteId: 'quote-1',
    });

    expect(records).toHaveLength(2);
    expect(records.map((record) => record.type)).toEqual([
      'QUOTE_SENT',
      'QUOTE_FOLLOW_UP',
    ]);
    expect(provider.send).toHaveBeenCalledTimes(1);
  });

  it('cancels pending quote follow-up while keeping sent quote history visible', async () => {
    const { records, service } = createHarness();
    await service.quoteSent({
      businessId: owner.businessId,
      createdBy: owner.id,
      publicUrl: 'http://localhost:3000/public/quotes/demo-token',
      quoteId: 'quote-1',
    });

    await service.quoteFinalised(owner.businessId, 'quote-1');

    expect(
      records.filter(
        (record) =>
          record.type === 'QUOTE_FOLLOW_UP' && record.status === 'CANCELLED',
      ),
    ).toHaveLength(1);
    expect(
      records.filter(
        (record) => record.type === 'QUOTE_SENT' && record.status === 'SENT',
      ),
    ).toHaveLength(1);
    const response = await service.findAll(owner, {
      customerId: 'customer-1',
      pageSize: 100,
    });
    expect(response.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: 'CANCELLED',
          type: 'QUOTE_FOLLOW_UP',
        }),
        expect.objectContaining({ status: 'SENT', type: 'QUOTE_SENT' }),
      ]),
    );
  });

  it('processes due quote follow-ups through the local provider', async () => {
    const { provider, records, service, setQuote } = createHarness();
    setQuote({ sentAt: makeDate('2026-08-08T04:00:00.000Z') });
    await service.quoteSent({
      businessId: owner.businessId,
      createdBy: owner.id,
      publicUrl: 'http://localhost:3000/public/quotes/demo-token',
      quoteId: 'quote-1',
    });
    provider.send.mockClear();

    await service.processDueCustomerCommunications(owner);

    const followUp = records.find(
      (record) => record.type === 'QUOTE_FOLLOW_UP',
    );
    expect(followUp?.status).toBe('SENT');
    expect(followUp?.sentAt).toBeInstanceOf(Date);
    expect(provider.send).toHaveBeenCalledTimes(1);
  });

  it('records quote communication failures without sending when recipient is missing', async () => {
    const { provider, records, service, setQuote } = createHarness();
    setQuote({
      customer: customer({ email: null, phone: null }),
    });

    await service.quoteSent({
      businessId: owner.businessId,
      createdBy: owner.id,
      publicUrl: 'http://localhost:3000/public/quotes/demo-token',
      quoteId: 'quote-1',
    });

    expect(records.map((record) => record.status)).toEqual([
      'FAILED',
      'FAILED',
    ]);
    expect(records.map((record) => record.failureReason)).toEqual([
      'COMMUNICATION_RECIPIENT_MISSING',
      'COMMUNICATION_RECIPIENT_MISSING',
    ]);
    expect(provider.send).not.toHaveBeenCalled();
  });

  it('creates invoice sent history and schedules due soon and overdue reminders', async () => {
    jest.useFakeTimers().setSystemTime(makeDate('2026-08-14T04:00:00.000Z'));
    const { provider, records, service } = createHarness();

    try {
      await service.invoiceSent({
        businessId: owner.businessId,
        createdBy: owner.id,
        invoiceId: 'invoice-1',
        publicUrl: 'http://localhost:3000/public/invoices/demo-token',
      });

      expect(records.map((record) => record.type)).toEqual([
        'INVOICE_SENT',
        'INVOICE_DUE_SOON',
        'INVOICE_OVERDUE',
      ]);
      expect(records[0]).toMatchObject({
        relatedInvoiceId: 'invoice-1',
        status: 'SENT',
        type: 'INVOICE_SENT',
      });
      expect(String(records[0].message)).toContain('Invoice total: $880.00');
      expect(String(records[0].message)).toContain('Due date: 20/08/2026');
      expect(String(records[0].message)).toContain(
        'View invoice: http://localhost:3000/public/invoices/demo-token',
      );
      expect(records[1]).toMatchObject({
        relatedInvoiceId: 'invoice-1',
        status: 'SCHEDULED',
        type: 'INVOICE_DUE_SOON',
      });
      expect((records[1].scheduledFor as Date).toISOString()).toBe(
        '2026-08-17T04:00:00.000Z',
      );
      expect(records[2]).toMatchObject({
        relatedInvoiceId: 'invoice-1',
        status: 'SCHEDULED',
        type: 'INVOICE_OVERDUE',
      });
      expect((records[2].scheduledFor as Date).toISOString()).toBe(
        '2026-08-21T04:00:00.000Z',
      );
      expect(provider.send).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not schedule invoice reminders when invoice reminder settings are off', async () => {
    const { records, service } = createHarness({
      invoiceDueSoonRemindersEnabled: false,
      invoiceOverdueRemindersEnabled: false,
    });

    await service.invoiceSent({
      businessId: owner.businessId,
      createdBy: owner.id,
      invoiceId: 'invoice-1',
      publicUrl: 'http://localhost:3000/public/invoices/demo-token',
    });

    expect(records.map((record) => record.type)).toEqual(['INVOICE_SENT']);
  });

  it('does not duplicate invoice sent or reminder records on retry', async () => {
    const { provider, records, service } = createHarness();

    await service.invoiceSent({
      businessId: owner.businessId,
      createdBy: owner.id,
      invoiceId: 'invoice-1',
      publicUrl: 'http://localhost:3000/public/invoices/demo-token',
    });
    await service.invoiceSent({
      businessId: owner.businessId,
      createdBy: owner.id,
      invoiceId: 'invoice-1',
      publicUrl: 'http://localhost:3000/public/invoices/demo-token',
    });

    expect(records).toHaveLength(3);
    expect(provider.send).toHaveBeenCalledTimes(1);
  });

  it('uses SMS for invoice communications when the customer only has a phone', async () => {
    const { records, service, setInvoice } = createHarness();
    setInvoice({
      customer: customer({
        communicationPreference: null,
        email: null,
        phone: '0414303777',
      }),
    });

    await service.invoiceSent({
      businessId: owner.businessId,
      createdBy: owner.id,
      invoiceId: 'invoice-1',
      publicUrl: 'http://localhost:3000/public/invoices/demo-token',
    });

    expect(records.map((record) => record.channel)).toEqual([
      'SMS',
      'SMS',
      'SMS',
    ]);
  });

  it('records payment received with remaining balance and payment id idempotency', async () => {
    const { provider, records, service } = createHarness();

    await service.paymentRecorded({
      businessId: owner.businessId,
      createdBy: owner.id,
      invoiceId: 'invoice-1',
      paymentId: 'payment-1',
    });
    await service.paymentRecorded({
      businessId: owner.businessId,
      createdBy: owner.id,
      invoiceId: 'invoice-1',
      paymentId: 'payment-1',
    });

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      relatedInvoiceId: 'invoice-1',
      relatedPaymentId: 'payment-1',
      status: 'SENT',
      type: 'PAYMENT_RECEIVED',
    });
    expect(String(records[0].message)).toContain('Amount received: $300.00');
    expect(String(records[0].message)).toContain('Remaining balance: $580.00');
    expect(provider.send).toHaveBeenCalledTimes(1);
  });

  it('allows multiple invoice payments to create separate payment confirmations', async () => {
    const { records, service, setPayment } = createHarness();
    await service.paymentRecorded({
      businessId: owner.businessId,
      createdBy: owner.id,
      invoiceId: 'invoice-1',
      paymentId: 'payment-1',
    });
    setPayment({
      amountCents: 58000,
      id: 'payment-2',
      invoice: invoice({
        amountPaidCents: 88000,
        balanceDueCents: 0,
        status: 'PAID',
      }),
    });

    await service.paymentRecorded({
      businessId: owner.businessId,
      createdBy: owner.id,
      invoiceId: 'invoice-1',
      paymentId: 'payment-2',
    });

    expect(
      records.filter((record) => record.type === 'PAYMENT_RECEIVED'),
    ).toHaveLength(2);
    expect(String(records[1].message)).toContain(
      'This invoice is now fully paid.',
    );
  });

  it('refreshes pending invoice reminder messages after partial payment', async () => {
    const { records, service, setInvoice } = createHarness();
    await service.invoiceSent({
      businessId: owner.businessId,
      createdBy: owner.id,
      invoiceId: 'invoice-1',
      publicUrl: 'http://localhost:3000/public/invoices/demo-token',
    });
    setInvoice({
      amountPaidCents: 30000,
      balanceDueCents: 58000,
      status: 'PARTIALLY_PAID',
    });

    await service.paymentRecorded({
      businessId: owner.businessId,
      createdBy: owner.id,
      invoiceId: 'invoice-1',
      paymentId: 'payment-1',
    });

    const dueSoon = records.find(
      (record) => record.type === 'INVOICE_DUE_SOON',
    );
    const overdue = records.find((record) => record.type === 'INVOICE_OVERDUE');
    expect(String(dueSoon?.message)).toContain('Remaining: $580.00');
    expect(String(overdue?.message)).toContain('Remaining: $580.00');
  });

  it('cancels invoice reminders after final payment even when payment confirmations are disabled', async () => {
    const { records, service, setPayment } = createHarness({
      paymentConfirmationsEnabled: false,
    });
    await service.invoiceSent({
      businessId: owner.businessId,
      createdBy: owner.id,
      invoiceId: 'invoice-1',
      publicUrl: 'http://localhost:3000/public/invoices/demo-token',
    });
    setPayment({
      invoice: invoice({
        amountPaidCents: 88000,
        balanceDueCents: 0,
        status: 'PAID',
      }),
    });

    await service.paymentRecorded({
      businessId: owner.businessId,
      createdBy: owner.id,
      invoiceId: 'invoice-1',
      paymentId: 'payment-1',
    });

    expect(
      records.filter(
        (record) =>
          ['INVOICE_DUE_SOON', 'INVOICE_OVERDUE'].includes(record.type) &&
          record.status === 'CANCELLED',
      ),
    ).toHaveLength(2);
    expect(records.some((record) => record.type === 'PAYMENT_RECEIVED')).toBe(
      false,
    );
  });

  it('cancels due invoice reminder instead of sending if invoice is paid before processing', async () => {
    const { provider, records, service, setInvoice } = createHarness();
    await service.invoiceSent({
      businessId: owner.businessId,
      createdBy: owner.id,
      invoiceId: 'invoice-1',
      publicUrl: 'http://localhost:3000/public/invoices/demo-token',
    });
    const dueSoon = records.find(
      (record) => record.type === 'INVOICE_DUE_SOON',
    );
    if (dueSoon) {
      dueSoon.scheduledFor = makeDate('2026-08-11T00:00:00.000Z');
    }
    setInvoice({
      amountPaidCents: 88000,
      balanceDueCents: 0,
      status: 'PAID',
    });
    provider.send.mockClear();

    await service.processDueCustomerCommunications(owner);

    expect(dueSoon?.status).toBe('CANCELLED');
    expect(provider.send).not.toHaveBeenCalled();
  });

  it('processes due eligible invoice overdue reminder once with current balance', async () => {
    const { provider, records, service, setInvoice } = createHarness({
      invoiceDueSoonRemindersEnabled: false,
    });
    setInvoice({
      amountPaidCents: 30000,
      balanceDueCents: 58000,
      dueDate: makeDate('2026-08-08T04:00:00.000Z'),
      status: 'OVERDUE',
    });
    await service.invoiceSent({
      businessId: owner.businessId,
      createdBy: owner.id,
      invoiceId: 'invoice-1',
      publicUrl: 'http://localhost:3000/public/invoices/demo-token',
    });
    provider.send.mockClear();

    await service.processDueCustomerCommunications(owner);
    await service.processDueCustomerCommunications(owner);

    const overdue = records.find((record) => record.type === 'INVOICE_OVERDUE');
    expect(overdue?.status).toBe('SENT');
    expect(String(overdue?.message)).toContain('Remaining: $580.00');
    expect(provider.send).toHaveBeenCalledTimes(1);
  });

  it('records no-recipient invoice communication failures without breaking invoice hooks', async () => {
    const { provider, records, service, setInvoice } = createHarness();
    setInvoice({
      customer: customer({ email: null, phone: null }),
    });

    await service.invoiceSent({
      businessId: owner.businessId,
      createdBy: owner.id,
      invoiceId: 'invoice-1',
      publicUrl: 'http://localhost:3000/public/invoices/demo-token',
    });

    expect(records.map((record) => record.status)).toEqual([
      'FAILED',
      'FAILED',
      'FAILED',
    ]);
    expect(provider.send).not.toHaveBeenCalled();
  });

  it('processes due scheduled communications once', async () => {
    const { provider, records, service, prisma } = createHarness();
    await service.appointmentCreated(prisma as never, owner, appointment());
    const reminder = records.find(
      (record) => record.type === 'APPOINTMENT_REMINDER',
    );
    if (reminder) {
      reminder.scheduledFor = makeDate('2026-08-11T00:00:00.000Z');
    }
    provider.send.mockClear();

    await service.processDueCustomerCommunications(owner);
    await service.processDueCustomerCommunications(owner);

    expect(provider.send).toHaveBeenCalledTimes(1);
    expect(
      records.filter((record) => record.type === 'APPOINTMENT_REMINDER')[0]
        .status,
    ).toBe('SENT');
  });

  it('lists scheduled customer communications with business and customer scope', async () => {
    const { records, service, prisma } = createHarness();
    await service.appointmentCreated(prisma as never, owner, appointment());

    const response = await service.findAll(owner, {
      customerId: 'customer-1',
      pageSize: 8,
    });

    expect(response.records.map((record) => record.status)).toContain(
      'SCHEDULED',
    );
    const lastFindManyCall =
      prisma.customerCommunication.findMany.mock.calls.at(-1)?.[0] as
        { where: { businessId?: string; customerId?: string } } | undefined;
    expect(lastFindManyCall?.where.businessId).toBe(owner.businessId);
    expect(lastFindManyCall?.where.customerId).toBe('customer-1');
    expect(records).toHaveLength(2);
  });

  it('keeps the original confirmation accessible after repeated reschedules and cancellation', async () => {
    const { records, service, prisma } = createHarness();
    await service.appointmentCreated(prisma as never, owner, appointment());

    for (const hour of [5, 6, 7, 8, 9, 10, 11, 12]) {
      await service.appointmentRescheduled(
        prisma as never,
        owner,
        appointment({
          scheduledEnd: makeDate(
            `2026-08-14T${String(hour + 2).padStart(2, '0')}:07:00.000Z`,
          ),
          scheduledStart: makeDate(
            `2026-08-14T${String(hour).padStart(2, '0')}:07:00.000Z`,
          ),
        }),
      );
    }
    await service.appointmentCancelled(prisma as never, owner, appointment());

    const response = await service.findAll(owner, {
      customerId: 'customer-1',
      pageSize: 100,
    });

    expect(records.filter((record) => record.status === 'SENT')).toHaveLength(
      10,
    );
    expect(response.records).toHaveLength(records.length);
    expect(response.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: 'SENT',
          type: 'APPOINTMENT_CONFIRMATION',
        }),
      ]),
    );
    expect(
      records.filter(
        (record) =>
          record.type === 'APPOINTMENT_CONFIRMATION' &&
          record.status === 'SENT',
      ),
    ).toHaveLength(1);
    expect(
      records.filter(
        (record) =>
          record.type !== 'APPOINTMENT_REMINDER' && record.status === 'SENT',
      ),
    ).toHaveLength(10);

    const lastFindManyCall =
      prisma.customerCommunication.findMany.mock.calls.at(-1)?.[0];
    expect(lastFindManyCall?.take).toBe(100);
    expect(lastFindManyCall?.orderBy).toEqual([
      { createdAt: 'desc' },
      { id: 'desc' },
    ]);
  });

  it('blocks read-only users from manual communications', async () => {
    const { service } = createHarness();

    let caught: unknown;
    try {
      await service.sendManual(readOnly, {
        channel: 'EMAIL',
        customerId: 'customer-1',
        message: 'Hello',
      });
    } catch (error: unknown) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(HttpException);
    if (!(caught instanceof HttpException)) {
      throw new Error('Expected HttpException');
    }
    expect(caught.getStatus()).toBe(403);
  });
});
