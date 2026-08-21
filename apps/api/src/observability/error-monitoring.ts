import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { redact, safeErrorCode, StructuredLogger } from './structured-logger';

export interface ErrorMonitoringEvent {
  businessId?: string;
  category?: string;
  error: unknown;
  errorCode?: string;
  operation?: string;
  requestId?: string;
  route?: string;
  statusCode?: number;
  userId?: string;
}

export interface ErrorMonitoringAdapter {
  capture(event: ErrorMonitoringEvent): void;
}

class NoopErrorMonitoringAdapter implements ErrorMonitoringAdapter {
  capture() {
    // Local/default provider intentionally does nothing.
  }
}

@Injectable()
export class ErrorMonitoringService {
  private readonly adapter: ErrorMonitoringAdapter;

  constructor(
    config: ConfigService,
    private readonly logger: StructuredLogger,
  ) {
    const provider = config.get<string>('ERROR_MONITORING_PROVIDER', 'none');
    this.adapter =
      provider === 'none'
        ? new NoopErrorMonitoringAdapter()
        : new NoopErrorMonitoringAdapter();
  }

  captureUnexpected(event: ErrorMonitoringEvent) {
    const statusCode = event.statusCode ?? 500;
    if (statusCode < 500) {
      return;
    }

    const safeEvent = {
      ...event,
      error: undefined,
      errorCode: event.errorCode ?? safeErrorCode(event.error),
    };
    this.logger.error('unexpected_error_captured', {
      ...safeEvent,
      category: event.category ?? 'error_monitoring',
    });
    this.adapter.capture(
      redact({
        ...event,
        error: safeErrorCode(event.error),
      }) as ErrorMonitoringEvent,
    );
  }
}
