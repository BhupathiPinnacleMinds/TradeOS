import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './observability/global-exception.filter';
import { ErrorMonitoringService } from './observability/error-monitoring';
import { createRequestLoggingMiddleware } from './observability/request-logging.middleware';
import {
  StructuredLogger,
  safeErrorCode,
} from './observability/structured-logger';

interface ProxyAwareExpressApp {
  set(setting: string, value: unknown): void;
}

function isAllowedDevOrigin(origin: string) {
  try {
    const url = new URL(origin);

    return (
      url.protocol === 'http:' &&
      (url.hostname === 'localhost' ||
        url.hostname === '127.0.0.1' ||
        url.hostname.startsWith('192.168.') ||
        url.hostname.startsWith('10.') ||
        url.hostname.startsWith('172.'))
    );
  } catch {
    return false;
  }
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const logger = app.get(StructuredLogger);
  const monitoring = app.get(ErrorMonitoringService);
  const isProduction = config.get<string>('NODE_ENV') === 'production';
  const trustProxy = config.get<string>('TRUST_PROXY', 'false') === 'true';
  const allowedOrigins = config
    .get<string>('CORS_ORIGINS', 'http://localhost:8081')
    .split(',')
    .map((origin: string) => origin.trim())
    .filter(Boolean);

  app.setGlobalPrefix('api');
  app.use(createRequestLoggingMiddleware(logger));
  if (trustProxy) {
    const expressApp = app
      .getHttpAdapter()
      .getInstance() as ProxyAwareExpressApp;
    expressApp.set('trust proxy', 1);
  }
  app.use(helmet());
  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void,
    ) => {
      if (!origin) {
        callback(null, true);
        return;
      }

      if (
        allowedOrigins.includes(origin) ||
        (!isProduction && isAllowedDevOrigin(origin))
      ) {
        callback(null, true);
        return;
      }

      callback(new Error(`Origin ${origin} is not allowed by CORS`));
    },
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }),
  );
  app.useGlobalFilters(new GlobalExceptionFilter(logger, monitoring));
  app.enableShutdownHooks();

  await app.listen(
    config.get<number>('PORT', 3000),
    config.get<string>('HOST', '0.0.0.0'),
  );
}

bootstrap().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      errorCode: safeErrorCode(error),
      level: 'error',
      message: 'api_startup_failed',
      timestamp: new Date().toISOString(),
    }),
  );
  process.exit(1);
});
