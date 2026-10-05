import { HttpStatus, Injectable } from '@nestjs/common';
import { ProofKind, Role } from '@prisma/client';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { ClockService } from '../../common/clock/clock.service';
import { AppException, ErrorCode } from '../../common/errors/app-exception';
import { uuidv7 } from '../../common/ids/uuid';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { sniffImage } from '../gyms/gym-logo.service';
import { NotificationsService } from '../notifications/notifications.service';

export const PROOF_MAX_BYTES = 8 * 1024 * 1024;
const PROOF_MAX_SIDE = 2048;
const MAX_PROOFS = 3;
const STAFF: Role[] = ['MODERATOR', 'ADMIN', 'SUPER_ADMIN'];

/**
 * Workout proofs (docs §3.5, Phase 3): up to three photos or screenshots per workout, re-encoded as WebP (which
 * drops EXIF, including GPS), stored under an unguessable key. Moderators verify or reject; a verified workout
 * weighs more in the performance component (`verified_weight_multiplier`).
 */
@Injectable()
export class ProofsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly clock: ClockService,
  ) {}

  async add(user: AuthUser, workoutId: string, kind: ProofKind, file: { buffer: Buffer; size: number } | undefined) {
    const w = await this.prisma.workout.findFirst({ where: { id: workoutId, userId: user.id, deletedAt: null } });
    if (!w) throw AppException.notFound('Workout');
    if (w.status !== 'ACCEPTED' && w.status !== 'HELD_FOR_REVIEW') throw AppException.conflict(ErrorCode.CONFLICT, 'Only accepted or held workouts take proofs.', { reason: 'WORKOUT_NOT_PROVABLE' });
    if (!file) throw AppException.validation([{ field: 'file', code: 'REQUIRED' }]);
    if (file.size > PROOF_MAX_BYTES) throw new AppException(HttpStatus.PAYLOAD_TOO_LARGE, ErrorCode.PAYLOAD_TOO_LARGE, 'A proof must be 8 MB or less.');
    if (!sniffImage(file.buffer)) throw new AppException(HttpStatus.UNSUPPORTED_MEDIA_TYPE, ErrorCode.UNSUPPORTED_MEDIA_TYPE, 'A proof must be a PNG, JPEG or WebP image.');
    if ((await this.prisma.proofMedia.count({ where: { workoutId } })) >= MAX_PROOFS) throw AppException.conflict(ErrorCode.CONFLICT, 'Three proofs at most per workout.', { reason: 'TOO_MANY_PROOFS' });

    let out: { data: Buffer; info: sharp.OutputInfo };
    try {
      // sharp keeps no metadata unless asked: EXIF (GPS, device) is gone after re-encoding.
      out = await sharp(file.buffer, { limitInputPixels: 60_000_000 })
        .rotate()
        .resize(PROOF_MAX_SIDE, PROOF_MAX_SIDE, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer({ resolveWithObject: true });
    } catch {
      throw new AppException(HttpStatus.UNSUPPORTED_MEDIA_TYPE, ErrorCode.UNSUPPORTED_MEDIA_TYPE, 'The image could not be decoded.');
    }
    const mediaId = uuidv7();
    const key = `proofs/${user.id}/${mediaId}.webp`;
    await this.storage.put(key, out.data, 'image/webp');
    await this.prisma.$transaction(async (tx) => {
      await tx.media.create({
        data: { id: mediaId, ownerId: user.id, bucket: 'proofs', objectKey: key, mime: 'image/webp', sizeBytes: out.data.length, sha256: createHash('sha256').update(out.data).digest(), status: 'READY', purpose: 'PROOF', width: out.info.width, height: out.info.height },
      });
      await tx.proofMedia.create({ data: { id: uuidv7(), workoutId, mediaId, kind } });
      // A new proof re-opens the review unless the workout is already verified.
      if (w.proofStatus !== 'VERIFIED') await tx.workout.update({ where: { id: workoutId }, data: { proofStatus: 'PENDING', proofNote: null } });
    });
    return this.list(user, workoutId);
  }

  async list(viewer: AuthUser, workoutId: string) {
    const w = await this.prisma.workout.findFirst({ where: { id: workoutId, deletedAt: null }, include: { proofs: { include: { media: true }, orderBy: { createdAt: 'asc' } } } });
    // Proofs are private: the athlete and moderators only.
    if (!w || (w.userId !== viewer.id && !STAFF.includes(viewer.role))) throw AppException.notFound('Workout');
    return {
      workoutId,
      status: w.proofStatus,
      note: w.proofNote,
      reviewedAt: w.proofReviewedAt?.toISOString() ?? null,
      proofs: w.proofs.map((p) => ({ id: p.id, kind: p.kind, url: this.storage.url(p.media.objectKey), width: p.media.width, height: p.media.height, createdAt: p.createdAt.toISOString() })),
    };
  }

  async remove(user: AuthUser, workoutId: string, proofId: string) {
    const p = await this.prisma.proofMedia.findFirst({ where: { id: proofId, workoutId, workout: { userId: user.id, deletedAt: null } }, include: { workout: true, media: true } });
    if (!p) throw AppException.notFound('Proof');
    // A verified workout keeps its proofs: removing one would undo the review silently.
    if (p.workout.proofStatus === 'VERIFIED') throw AppException.conflict(ErrorCode.CONFLICT, 'Proofs of a verified workout are kept.', { reason: 'PROOF_LOCKED' });
    await this.prisma.$transaction(async (tx) => {
      await tx.proofMedia.delete({ where: { id: proofId } });
      await tx.media.update({ where: { id: p.mediaId }, data: { status: 'DELETED' } });
      if ((await tx.proofMedia.count({ where: { workoutId } })) === 0) await tx.workout.update({ where: { id: workoutId }, data: { proofStatus: 'NONE', proofNote: null } });
    });
    await this.storage.delete(p.media.objectKey).catch(() => undefined);
    return this.list(user, workoutId);
  }

  // ───────────── Moderation ─────────────

  async queue() {
    const rows = await this.prisma.workout.findMany({
      where: { proofStatus: 'PENDING', deletedAt: null },
      orderBy: { updatedAt: 'asc' },
      take: 50,
      include: {
        proofs: { include: { media: true } },
        user: { select: { username: true } },
        sport: { select: { code: true } },
        exercises: { include: { exercise: { select: { code: true } }, sets: true }, orderBy: { position: 'asc' } },
      },
    });
    return rows.map((w) => ({
      workoutId: w.id,
      username: w.user.username,
      sport: w.sport.code,
      performedAt: w.performedAt.toISOString(),
      durationS: w.durationS,
      exercises: w.exercises.map((e) => ({ code: e.exercise.code, sets: e.sets.map((s) => ({ reps: s.reps, weightKg: s.weightKg === null ? null : Number(s.weightKg), distanceM: s.distanceM, durationS: s.durationS })) })),
      proofs: w.proofs.map((p) => ({ id: p.id, kind: p.kind, url: this.storage.url(p.media.objectKey) })),
    }));
  }

  async decide(actor: AuthUser, workoutId: string, decision: 'VERIFY' | 'REJECT', note?: string) {
    const w = await this.prisma.workout.findFirst({ where: { id: workoutId, deletedAt: null } });
    if (!w) throw AppException.notFound('Workout');
    if (w.proofStatus !== 'PENDING') throw AppException.conflict(ErrorCode.CONFLICT, 'Nothing to review on this workout.', { reason: 'NOT_PENDING' });
    if (w.userId === actor.id) throw AppException.forbidden('You cannot review your own workout.');
    const text = note?.trim() || null;
    if (decision === 'REJECT' && !text) throw AppException.validation([{ field: 'note', code: 'REQUIRED' }]);
    const verified = decision === 'VERIFY';
    await this.prisma.$transaction(async (tx) => {
      await tx.workout.update({
        where: { id: workoutId },
        data: { proofStatus: verified ? 'VERIFIED' : 'REJECTED', isVerified: verified, proofReviewedById: actor.id, proofReviewedAt: this.clock.now(), proofNote: text },
      });
      await this.notifications.notify(tx, w.userId, verified ? 'PROOF_VERIFIED' : 'PROOF_REJECTED', { workoutId, note: text });
      await this.audit.log({ actorId: actor.id, actorRole: actor.role, action: verified ? 'PROOF_VERIFIED' : 'PROOF_REJECTED', entityType: 'workout', entityId: workoutId, after: { note: text } }, tx);
    });
    return { workoutId, status: verified ? 'VERIFIED' : 'REJECTED' };
  }
}
