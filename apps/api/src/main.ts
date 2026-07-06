import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  app.setGlobalPrefix('api');
  app.use(helmet());
  app.enableCors({
    origin: config
      .get<string>('CORS_ORIGINS', 'http://localhost:8081')
      .split(',')
      .map((origin: string) => origin.trim()),
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }),
  );
  app.enableShutdownHooks();

  await app.listen(config.get<number>('PORT', 3000));
}

bootstrap().catch((error: unknown) => {
  console.error('Failed to start TradieOS API', error);
  process.exit(1);
});
