import { Global, Module } from '@nestjs/common';
import { ErrorMonitoringService } from './error-monitoring';
import { StructuredLogger } from './structured-logger';

@Global()
@Module({
  exports: [StructuredLogger, ErrorMonitoringService],
  providers: [StructuredLogger, ErrorMonitoringService],
})
export class ObservabilityModule {}
