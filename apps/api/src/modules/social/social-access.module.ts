import { Global, Module } from '@nestjs/common';
import { SocialAccess } from './social-access';

@Global()
@Module({ providers: [SocialAccess], exports: [SocialAccess] })
export class SocialAccessModule {}
