import { Injectable } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { uuidv7 } from '../ids/uuid';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  actorId?: string | null;
  actorRole?: Role | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  requestId?: string;
}

/** Append-only audit trail (docs §18.5). Never put secrets or health data in before/after. */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(entry: AuditEntry, tx: Prisma.TransactionClient = this.prisma): Promise<void> {
    await tx.auditLog.create({ data: { id: uuidv7(), ...entry } });
  }
}
