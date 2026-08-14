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

type CommunicationRecord = Record<string, unknown> & {
  businessId: string;
  id: string;
  idempotencyKey: string;
  relatedAppointmentId?: string | null;
  status: string;
  type: string;
  updatedAt: Date;
};

type ListArgs = {
  take?: number;
  where?: {
    status?: string;
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
                !args?.where?.status || record.status === args.where.status,
            )
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
              record.relatedAppointmentId === args.where.relatedAppointmentId)
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
  };
  return {
    prisma,
    provider,
    records,
    service: new CustomerCommunicationsService(prisma as never, provider),
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

  it('processes due scheduled communications once', async () => {
    const { provider, records, service, prisma } = createHarness();
    await service.appointmentCreated(prisma as never, owner, appointment());
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
