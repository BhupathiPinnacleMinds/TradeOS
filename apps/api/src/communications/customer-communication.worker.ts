import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StructuredLogger } from '../observability/structured-logger';
import { CustomerCommunicationsService } from './communications.service';

const DEFAULT_INTERVAL_SECONDS = 300;
const DEFAULT_BATCH_SIZE = 50;
const MIN_INTERVAL_SECONDS = 60;
const MAX_BATCH_SIZE = 250;

@Injectable()
export class CustomerCommunicationWorker
  implements OnModuleInit, OnModuleDestroy
{
  private readonly enabled: boolean;
  private readonly intervalSeconds: number;
  private readonly batchSize: number;
  private interval: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly communications: CustomerCommunicationsService,
    private readonly logger: StructuredLogger,
    config: ConfigService,
  ) {
    this.enabled =
      config.get<string>('CUSTOMER_COMMUNICATION_WORKER_ENABLED', 'false') ===
      'true';
    this.intervalSeconds = normalisePositiveInteger(
      config.get<string>('CUSTOMER_COMMUNICATION_WORKER_INTERVAL_SECONDS'),
      DEFAULT_INTERVAL_SECONDS,
      MIN_INTERVAL_SECONDS,
    );
    this.batchSize = Math.min(
      normalisePositiveInteger(
        config.get<string>('CUSTOMER_COMMUNICATION_WORKER_BATCH_SIZE'),
        DEFAULT_BATCH_SIZE,
        1,
      ),
      MAX_BATCH_SIZE,
    );
  }

  onModuleInit() {
    if (!this.enabled) {
      this.logger.info('communications_worker_disabled', {
        category: 'communications_worker',
        event: 'communications_worker_disabled',
      });
      return;
    }
    this.logger.info('communications_worker_started', {
      batchSize: this.batchSize,
      category: 'communications_worker',
      event: 'communications_worker_started',
      intervalSeconds: this.intervalSeconds,
    });
    this.interval = setInterval(() => {
      void this.tick();
    }, this.intervalSeconds * 1000);
    this.interval.unref?.();
    void this.tick();
  }

  onModuleDestroy() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  async tick() {
    if (!this.enabled) {
      return null;
    }
    if (this.running) {
      this.logger.warn('communications_worker_skipped', {
        category: 'communications_worker',
        event: 'communications_worker_skipped',
        reason: 'busy',
      });
      return null;
    }
    this.running = true;
    try {
      const result = await this.communications.processDueCustomerCommunications(
        undefined,
        this.batchSize,
      );
      this.logger.info('communications_worker_completed', {
        category: 'communications_worker',
        claimed: result.claimed,
        due: result.due,
        durationMs: result.durationMs,
        event: 'communications_worker_completed',
        failed: result.failed,
        sent: result.sent,
        skipped: result.skipped,
      });
      return result;
    } catch (error) {
      this.logger.error('communications_worker_failed', {
        category: 'communications_worker',
        errorCode: safeError(error),
        event: 'communications_worker_failed',
      });
      return null;
    } finally {
      this.running = false;
    }
  }
}

function normalisePositiveInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum) return fallback;
  return parsed;
}

function safeError(error: unknown) {
  return error instanceof Error
    ? error.message.slice(0, 240)
    : 'COMMUNICATION_WORKER_FAILED';
}
