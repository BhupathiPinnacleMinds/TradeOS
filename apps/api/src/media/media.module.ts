import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { STORAGE_PROVIDER, storageProviderFactory } from './storage-provider';

@Module({
  controllers: [MediaController],
  imports: [PrismaModule],
  providers: [
    MediaService,
    {
      inject: [ConfigService],
      provide: STORAGE_PROVIDER,
      useFactory: storageProviderFactory,
    },
  ],
  exports: [MediaService, STORAGE_PROVIDER],
})
export class MediaModule {}
