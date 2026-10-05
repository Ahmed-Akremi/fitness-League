import { Module } from '@nestjs/common';
import { AdminProofsController, ProofsController } from './proofs.controller';
import { ProofsService } from './proofs.service';

@Module({ controllers: [ProofsController, AdminProofsController], providers: [ProofsService] })
export class ProofsModule {}
