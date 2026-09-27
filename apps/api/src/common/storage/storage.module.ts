import { Global, Module } from '@nestjs/common';
import { join } from 'node:path';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env.schema';
import { LocalStorage } from './local-storage';
import { MediaController } from './media.controller';
import { S3Storage } from './s3-storage';
import { StorageService } from './storage.service';

@Global()
@Module({
  controllers: [MediaController],
  providers: [
    {
      provide: StorageService,
      inject: [ENV],
      useFactory: (env: Env): StorageService =>
        env.STORAGE_DRIVER === 's3'
          ? new S3Storage({
              endpoint: env.S3_ENDPOINT,
              region: env.S3_REGION,
              bucket: env.S3_BUCKET!,
              accessKeyId: env.S3_ACCESS_KEY!,
              secretAccessKey: env.S3_SECRET_KEY!,
              publicBaseUrl: env.MEDIA_PUBLIC_BASE_URL,
            })
          : new LocalStorage(env.STORAGE_LOCAL_DIR ?? join(process.cwd(), 'storage'), env.MEDIA_PUBLIC_BASE_URL),
    },
  ],
  exports: [StorageService],
})
export class StorageModule {}
