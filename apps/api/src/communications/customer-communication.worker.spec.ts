import { ConfigService } from '@nestjs/config';
import { CustomerCommunicationWorker } from './customer-communication.worker';
import { CustomerCommunicationsService } from './communications.service';

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

function config(values: Record<string, string | undefined>) {
  return {
    get: jest.fn((key: string, fallback?: string) => values[key] ?? fallback),
  } as unknown as ConfigService;
}

describe('CustomerCommunicationWorker', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('does not process communications when disabled', async () => {
    const service = {
      processDueCustomerCommunications: jest.fn(),
    };
    const worker = new CustomerCommunicationWorker(
      service as unknown as CustomerCommunicationsService,
      config({ CUSTOMER_COMMUNICATION_WORKER_ENABLED: 'false' }),
    );

    worker.onModuleInit();
    const result = await worker.tick();
    worker.onModuleDestroy();

    expect(result).toBeNull();
    expect(service.processDueCustomerCommunications).not.toHaveBeenCalled();
  });

  it('processes due communications with the configured batch size when enabled', async () => {
    const service = {
      processDueCustomerCommunications: jest.fn().mockResolvedValue({
        claimed: 1,
        due: 1,
        durationMs: 4,
        failed: 0,
        processed: 1,
        sent: 1,
        skipped: 0,
      }),
    };
    const worker = new CustomerCommunicationWorker(
      service as unknown as CustomerCommunicationsService,
      config({
        CUSTOMER_COMMUNICATION_WORKER_BATCH_SIZE: '12',
        CUSTOMER_COMMUNICATION_WORKER_ENABLED: 'true',
        CUSTOMER_COMMUNICATION_WORKER_INTERVAL_SECONDS: '300',
      }),
    );

    const result = await worker.tick();
    worker.onModuleDestroy();

    expect(result).toMatchObject({ claimed: 1, sent: 1 });
    expect(service.processDueCustomerCommunications).toHaveBeenCalledWith(
      undefined,
      12,
    );
  });

  it('skips overlapping ticks inside one API process', async () => {
    let resolveProcessing!: (value: unknown) => void;
    const service = {
      processDueCustomerCommunications: jest.fn().mockReturnValue(
        new Promise((resolve) => {
          resolveProcessing = resolve;
        }),
      ),
    };
    const worker = new CustomerCommunicationWorker(
      service as unknown as CustomerCommunicationsService,
      config({ CUSTOMER_COMMUNICATION_WORKER_ENABLED: 'true' }),
    );

    const first = worker.tick();
    const second = await worker.tick();
    resolveProcessing({
      claimed: 0,
      due: 0,
      durationMs: 1,
      failed: 0,
      processed: 0,
      sent: 0,
      skipped: 0,
    });
    await first;
    worker.onModuleDestroy();

    expect(second).toBeNull();
    expect(service.processDueCustomerCommunications).toHaveBeenCalledTimes(1);
  });
});
