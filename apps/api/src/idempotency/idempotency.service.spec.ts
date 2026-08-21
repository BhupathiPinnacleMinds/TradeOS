import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IdempotencyService } from './idempotency.service';

type RecordRow = {
  businessId?: string | null;
  completedAt?: Date | null;
  errorCode?: string | null;
  expiresAt: Date;
  id: string;
  keyHash: string;
  operation: string;
  publicScopeHash?: string | null;
  requestHash: string;
  responseBody?: unknown;
  responseStatus?: number | null;
  status: 'FAILED' | 'IN_PROGRESS' | 'SUCCESS';
  updatedAt: Date;
  userId?: string | null;
};

class FakePrisma {
  records: RecordRow[] = [];

  idempotencyRecord = {
    create: jest.fn(({ data }: { data: Partial<RecordRow> }) => {
      if (
        this.records.some((record) =>
          data.businessId
            ? record.businessId === data.businessId &&
              record.userId === data.userId &&
              record.operation === data.operation &&
              record.keyHash === data.keyHash
            : record.publicScopeHash === data.publicScopeHash &&
              record.operation === data.operation &&
              record.keyHash === data.keyHash,
        )
      ) {
        const error = new Error('Unique constraint failed') as Error & {
          code: string;
        };
        error.code = 'P2002';
        throw error;
      }

      const row: RecordRow = {
        businessId: data.businessId ?? null,
        expiresAt: data.expiresAt ?? new Date(),
        id: `idem_${this.records.length + 1}`,
        keyHash: data.keyHash ?? '',
        operation: data.operation ?? '',
        publicScopeHash: data.publicScopeHash ?? null,
        requestHash: data.requestHash ?? '',
        status: data.status ?? 'IN_PROGRESS',
        updatedAt: new Date(),
        userId: data.userId ?? null,
      };
      this.records.push(row);
      return Promise.resolve(row);
    }),
    findFirst: jest.fn(({ where }: { where: Partial<RecordRow> }) =>
      Promise.resolve(
        this.records.find((record) =>
          Object.entries(where).every(
            ([key, value]) => record[key as keyof RecordRow] === value,
          ),
        ) ?? null,
      ),
    ),
    findFirstOrThrow: jest.fn(({ where }: { where: Partial<RecordRow> }) => {
      const record = this.records.find((row) =>
        Object.entries(where).every(
          ([key, value]) => row[key as keyof RecordRow] === value,
        ),
      );
      if (!record) {
        throw new Error('Not found');
      }
      return Promise.resolve(record);
    }),
    update: jest.fn(
      ({
        data,
        where,
      }: {
        data: Partial<RecordRow>;
        where: { id: string };
      }) => {
        const record = this.records.find((row) => row.id === where.id);
        if (!record) {
          throw new Error('Not found');
        }
        Object.assign(record, data, { updatedAt: new Date() });
        return Promise.resolve(record);
      },
    ),
    updateMany: jest.fn(
      ({
        data,
        where,
      }: {
        data: Partial<RecordRow>;
        where: Partial<RecordRow>;
      }) => {
        const record = this.records.find((row) =>
          Object.entries(where).every(
            ([key, value]) => row[key as keyof RecordRow] === value,
          ),
        );
        if (!record) {
          return Promise.resolve({ count: 0 });
        }
        Object.assign(record, data, { updatedAt: new Date() });
        return Promise.resolve({ count: 1 });
      },
    ),
  };
}

function createService() {
  return new IdempotencyService(
    new FakePrisma() as never,
    { get: jest.fn(() => undefined) } as unknown as ConfigService,
  );
}

describe('IdempotencyService', () => {
  it('replays the original successful response for the same key, operation and request', async () => {
    const service = createService();
    const handler = jest
      .fn()
      .mockResolvedValue({ id: 'quote_1', quoteNumber: 'Q-001' });

    const scope = {
      businessId: 'business_1',
      idempotencyKey: 'quote-create-user-action-1',
      operation: 'quote.create',
      request: { title: 'Install ceiling fan' },
      userId: 'user_1',
    };

    const first = await service.runAuthenticated(scope, handler);
    const second = await service.runAuthenticated(scope, handler);

    expect(first).toEqual({ id: 'quote_1', quoteNumber: 'Q-001' });
    expect(second).toEqual(first);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('rejects the same key reused with a different payload', async () => {
    const service = createService();

    await service.runAuthenticated(
      {
        businessId: 'business_1',
        idempotencyKey: 'payment-key-1',
        operation: 'invoice.recordPayment',
        request: { amountCents: 12000 },
        userId: 'user_1',
      },
      () => Promise.resolve({ id: 'payment_1' }),
    );

    try {
      await service.runAuthenticated(
        {
          businessId: 'business_1',
          idempotencyKey: 'payment-key-1',
          operation: 'invoice.recordPayment',
          request: { amountCents: 13000 },
          userId: 'user_1',
        },
        () => Promise.resolve({ id: 'payment_2' }),
      );
      throw new Error('Expected idempotency conflict.');
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictException);
      const conflict = error as ConflictException;
      expect(conflict.getStatus()).toBe(409);
      expect(conflict.getResponse()).toMatchObject({
        code: 'IDEMPOTENCY_KEY_REUSED',
      });
    }
  });

  it('scopes authenticated keys by business and user', async () => {
    const service = createService();
    const handler = jest.fn(({ id }: { id: string }) =>
      Promise.resolve({ id }),
    );

    const one = await service.runAuthenticated(
      {
        businessId: 'business_1',
        idempotencyKey: 'same-visible-key',
        operation: 'appointment.create',
        request: { title: 'Inspection' },
        userId: 'user_1',
      },
      () => handler({ id: 'appointment_1' }),
    );
    const two = await service.runAuthenticated(
      {
        businessId: 'business_2',
        idempotencyKey: 'same-visible-key',
        operation: 'appointment.create',
        request: { title: 'Inspection' },
        userId: 'user_1',
      },
      () => handler({ id: 'appointment_2' }),
    );

    expect(one).toEqual({ id: 'appointment_1' });
    expect(two).toEqual({ id: 'appointment_2' });
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('supports public idempotency scopes without storing raw public tokens', async () => {
    const service = createService();
    const handler = jest.fn().mockResolvedValue({ status: 'ACCEPTED' });

    const first = await service.runPublic(
      {
        fallbackKey: 'quote-token-value:accept',
        operation: 'publicQuote.accept',
        publicScope: 'quote-token-value',
        request: { acceptedTerms: true },
      },
      handler,
    );
    const second = await service.runPublic(
      {
        fallbackKey: 'quote-token-value:accept',
        operation: 'publicQuote.accept',
        publicScope: 'quote-token-value',
        request: { acceptedTerms: true },
      },
      handler,
    );

    expect(second).toEqual(first);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('waits for an in-progress duplicate and returns the completed response', async () => {
    const service = createService();
    let release!: () => void;
    const firstHandler = jest.fn(
      () =>
        new Promise<{ id: string }>((resolve) => {
          release = () => resolve({ id: 'invoice_1' });
        }),
    );
    const secondHandler = jest.fn().mockResolvedValue({ id: 'invoice_2' });

    const scope = {
      businessId: 'business_1',
      idempotencyKey: 'invoice-create-double-tap',
      operation: 'invoice.create',
      request: { title: 'Call-out invoice' },
      userId: 'user_1',
    };

    const firstPromise = service.runAuthenticated(scope, firstHandler);
    await waitFor(() => Boolean(release));
    const secondPromise = service.runAuthenticated(scope, secondHandler);
    release();

    await expect(firstPromise).resolves.toEqual({ id: 'invoice_1' });
    await expect(secondPromise).resolves.toEqual({ id: 'invoice_1' });
    expect(firstHandler).toHaveBeenCalledTimes(1);
    expect(secondHandler).not.toHaveBeenCalled();
  });
});

async function waitFor(predicate: () => boolean) {
  const deadline = Date.now() + 1000;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  if (!predicate()) {
    throw new Error('Timed out waiting for test precondition.');
  }
}
