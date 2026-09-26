import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConsentType } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { ClockService } from '../../common/clock/clock.service';
import { HealthDataCipher } from '../../common/crypto/health-data-cipher';
import { AppException, ErrorCode } from '../../common/errors/app-exception';
import { uuidv7 } from '../../common/ids/uuid';
import { OutboxService } from '../../common/outbox/outbox.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { DeleteAccountDto } from '../auth/dto/auth.dto';
import { PasswordService } from '../auth/password.service';
import { BodyMeasurementDto, ConsentUpdateDto } from './dto/onboarding.dto';

export const DELETION_GRACE_DAYS = 30;

/** Consents, health data, data export and account deletion (docs §5, §9.7). */
@Injectable()
export class PrivacyService {
  private readonly logger = new Logger(PrivacyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: HealthDataCipher,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
    private readonly clock: ClockService,
    private readonly outbox: OutboxService,
  ) {}

  // ─────────── Consents ───────────

  /** Latest decision per consent type (the table is an append-only history). */
  async consents(userId: string) {
    const rows = await this.prisma.consent.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
    const latest = new Map<ConsentType, (typeof rows)[number]>();
    for (const r of rows) if (!latest.has(r.type)) latest.set(r.type, r);
    return [...latest.values()].map((c) => ({ type: c.type, granted: c.granted, documentVersion: c.documentVersion, at: c.createdAt.toISOString() }));
  }

  async updateConsent(userId: string, dto: ConsentUpdateDto) {
    await this.prisma.consent.create({ data: { id: uuidv7(), userId, type: dto.type, granted: dto.granted, documentVersion: dto.documentVersion } });
    return this.consents(userId);
  }

  private async hasConsent(userId: string, type: ConsentType): Promise<boolean> {
    const last = await this.prisma.consent.findFirst({ where: { userId, type }, orderBy: { createdAt: 'desc' } });
    return last?.granted === true;
  }

  // ─────────── Health data ───────────

  async addBodyMeasurement(userId: string, dto: BodyMeasurementDto) {
    if (!(await this.hasConsent(userId, 'HEALTH_DATA'))) {
      throw new AppException(HttpStatus.FORBIDDEN, ErrorCode.CONSENT_REQUIRED, 'Health data consent required', { extra: { consent: 'HEALTH_DATA' } });
    }
    const measuredAt = dto.measuredAt ? new Date(dto.measuredAt) : this.clock.now();
    if (measuredAt.getTime() > this.clock.now().getTime() + 10 * 60_000) {
      throw AppException.validation([{ field: 'measuredAt', code: 'IN_FUTURE' }]);
    }
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.bodyMeasurement.create({
      data: {
        id: uuidv7(),
        userId,
        measuredAt,
        weightKgEnc: this.cipher.encryptNumber(dto.weightKg),
        bodyFatPctEnc: dto.bodyFatPct !== undefined ? this.cipher.encryptNumber(dto.bodyFatPct) : null,
        keyId: this.cipher.activeKeyId,
        source: dto.source ?? 'MANUAL',
      },
      });
      // Weight goals react to new measurements (only the safe-rate part of a change counts).
      await this.outbox.enqueue(tx, 'BodyMeasurementAdded', { userId });
      return created;
    });
    return this.toMeasurement(row);
  }

  /** Owner-only; there is deliberately no endpoint exposing another user's measurements. */
  async bodyMeasurements(userId: string, limit = 100) {
    const rows = await this.prisma.bodyMeasurement.findMany({ where: { userId }, orderBy: { measuredAt: 'desc' }, take: limit });
    return rows.map((r) => this.toMeasurement(r));
  }

  /** Latest body weight for server-side use (plausibility, strength standards). Never exposed to others. */
  async latestWeightKg(userId: string): Promise<number | null> {
    const row = await this.prisma.bodyMeasurement.findFirst({ where: { userId, weightKgEnc: { not: null } }, orderBy: { measuredAt: 'desc' } });
    return row?.weightKgEnc ? this.cipher.decryptNumber(row.weightKgEnc) : null;
  }

  private toMeasurement(r: { id: string; measuredAt: Date; weightKgEnc: Uint8Array | null; bodyFatPctEnc: Uint8Array | null; source: string }) {
    return {
      id: r.id,
      measuredAt: r.measuredAt.toISOString(),
      weightKg: r.weightKgEnc ? this.cipher.decryptNumber(r.weightKgEnc) : null,
      bodyFatPct: r.bodyFatPctEnc ? this.cipher.decryptNumber(r.bodyFatPctEnc) : null,
      source: r.source,
    };
  }

  // ─────────── Export ───────────

  /**
   * Everything we hold about the user, as JSON. ASSUMPTION: served synchronously in Phase 1 (volumes are small);
   * the async zip + emailed link of docs §9.7 comes with the media module.
   */
  async export(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { profile: true, settings: true, sports: true, baselines: true, personalRecords: true, goals: { include: { milestones: true } } },
    });
    const [workouts, xp, lp, consents, measurements] = await Promise.all([
      this.prisma.workout.findMany({ where: { userId }, include: { exercises: { include: { sets: true } }, evaluation: true } }),
      this.prisma.xpTransaction.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.leaguePointTransaction.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.consent.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
      this.bodyMeasurements(userId, 10_000),
    ]);
    const { passwordHash: _p, totpSecretEnc: _t, goals, ...account } = user;
    return {
      exportedAt: this.clock.now().toISOString(),
      account: { ...account, dateOfBirth: user.dateOfBirth.toISOString().slice(0, 10) },
      goals: goals.map(({ startValueEnc, targetValueEnc, milestones, ...g }) => ({
        ...g,
        startValue: startValueEnc ? this.cipher.decryptNumber(startValueEnc) : g.startValue,
        targetValue: targetValueEnc ? this.cipher.decryptNumber(targetValueEnc) : g.targetValue,
        milestones: milestones.map(({ targetValueEnc: enc, ...m }) => ({ ...m, targetValue: enc ? this.cipher.decryptNumber(enc) : m.targetValue })),
      })),
      bodyMeasurements: measurements,
      workouts: workouts.map(({ payloadHash: _h, fingerprint: _f, ...w }) => w),
      xpTransactions: xp,
      leaguePointTransactions: lp,
      consents,
    };
  }

  // ─────────── Deletion ───────────

  /** Schedules deletion after a grace period and signs the user out everywhere; signing in again cancels it. */
  async requestDeletion(userId: string, dto: DeleteAccountDto): Promise<{ scheduledFor: string }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.passwordHash && !(await this.passwords.verify(user.passwordHash, dto.password ?? ''))) {
      throw AppException.unauthenticated(ErrorCode.INVALID_CREDENTIALS, 'Password required to delete the account');
    }
    const now = this.clock.now();
    const scheduledFor = new Date(now.getTime() + DELETION_GRACE_DAYS * 86_400_000);
    await this.prisma.$transaction(async (tx) => {
      await tx.dataRequest.updateMany({ where: { userId, type: 'DELETION', status: 'PENDING' }, data: { status: 'CANCELLED' } });
      await tx.dataRequest.create({ data: { id: uuidv7(), userId, type: 'DELETION', scheduledFor } });
      await tx.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } });
      await tx.user.update({ where: { id: userId }, data: { sessionVersion: { increment: 1 } } });
      await this.audit.log({ actorId: userId, action: 'ACCOUNT_DELETION_REQUESTED', entityType: 'user', entityId: userId, after: { scheduledFor: scheduledFor.toISOString() } }, tx);
    });
    return { scheduledFor: scheduledFor.toISOString() };
  }

  /**
   * Worker job (daily): anonymises accounts whose grace period is over. Personal data is erased; ledgers and
   * rankings stay consistent because they keep pointing at the (now anonymous) user row (docs §9.7).
   */
  async processDueDeletions(): Promise<number> {
    const now = this.clock.now();
    const due = await this.prisma.dataRequest.findMany({ where: { type: 'DELETION', status: 'PENDING', scheduledFor: { lte: now } } });
    for (const request of due) {
      const tag = request.userId.replace(/-/g, '').slice(-12);
      await this.prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: request.userId },
          data: {
            email: `deleted-${request.userId}@deleted.invalid`,
            username: `deleted_${tag}`,
            passwordHash: null,
            phoneE164: null,
            phoneVerifiedAt: null,
            totpSecretEnc: null,
            dateOfBirth: new Date('1900-01-01T00:00:00Z'),
            status: 'DELETED',
            deletedAt: now,
            anonymisedAt: now,
            sessionVersion: { increment: 1 },
          },
        });
        await tx.profile.update({ where: { userId: request.userId }, data: { fullName: 'Deleted athlete', bio: null, avatarMediaId: null, gender: null } });
        await tx.bodyMeasurement.deleteMany({ where: { userId: request.userId } });
        await tx.goal.updateMany({ where: { userId: request.userId }, data: { startValueEnc: null, targetValueEnc: null, deletedAt: now } });
        await tx.oAuthIdentity.deleteMany({ where: { userId: request.userId } });
        await tx.refreshToken.deleteMany({ where: { userId: request.userId } });
        await tx.verificationToken.deleteMany({ where: { userId: request.userId } });
        await tx.device.deleteMany({ where: { userId: request.userId } });
        await tx.workout.updateMany({ where: { userId: request.userId }, data: { notes: null, visibility: 'PRIVATE' } });
        await tx.dataRequest.update({ where: { id: request.id }, data: { status: 'COMPLETED', completedAt: now } });
        await this.audit.log({ actorId: null, action: 'ACCOUNT_ANONYMISED', entityType: 'user', entityId: request.userId }, tx);
      });
    }
    if (due.length) this.logger.log(`Anonymised ${due.length} account(s)`);
    return due.length;
  }
}
