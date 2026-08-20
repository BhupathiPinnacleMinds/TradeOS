import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CustomerCommunicationsService } from './communications.service';

const DEFAULT_INTERVAL_SECONDS = 300;
const DEFAULT_BATCH_SIZE = 50;
const MIN_INTERVAL_SECONDS = 60;
const MAX_BATCH_SIZE = 250;

@Injectable()
export class CustomerCommunicationWorker
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(CustomerCommunicationWorker.name);
  private readonly enabled: boolean;
  private readonly intervalSeconds: number;
  private readonly batchSize: number;
  private interval: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly communications: CustomerCommunicationsService,
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
      this.logger.log('Customer communication worker disabled.');
      return;
    }
    this.logger.log(
      `Customer communication worker enabled. intervalSeconds=${this.intervalSeconds} batchSize=${this.batchSize}`,
    );
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
      this.logger.warn('Customer communication worker tick skipped: busy.');
      return null;
    }
    this.running = true;
    try {
      const result = await this.communications.processDueCustomerCommunications(
        undefined,
        this.batchSize,
      );
      this.logger.log(
        `Customer communication worker tick complete. due=${result.due} claimed=${result.claimed} sent=${result.sent} failed=${result.failed} skipped=${result.skipped} durationMs=${result.durationMs}`,
      );
      return result;
    } catch (error) {
      this.logger.error(
        `Customer communication worker tick failed: ${safeError(error)}`,
      );
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
