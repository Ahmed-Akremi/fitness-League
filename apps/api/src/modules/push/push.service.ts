import { Inject, Injectable } from '@nestjs/common';
import { Platform } from '@prisma/client';
import { BusinessCalendar } from '../../common/clock/business-calendar';
import { ClockService } from '../../common/clock/clock.service';
import { uuidv7 } from '../../common/ids/uuid';
import { PrismaService } from '../../common/prisma/prisma.service';
import { normalisePrefs, PUSH_CATEGORIES, PushCategory, PushPrefs, shouldPush } from './push-policy';
import { PUSH_SENDER, type PushSender } from './push-sender';
import { pushText } from './push-texts';

const hhmm = (d: Date | null) => (d ? d.toISOString().slice(11, 16) : null);
const timeCol = (s: string) => new Date(`1970-01-01T${s}:00Z`);
const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Push delivery (docs §3.9, Q-17): every in-app notification goes through the outbox; here it becomes a push on
 * the athlete's registered devices unless its category is off or it falls in their quiet hours.
 */
@Injectable()
export class PushService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PUSH_SENDER) private readonly sender: PushSender,
    private readonly clock: ClockService,
    private readonly calendar: BusinessCalendar,
  ) {}

  async deliver(notificationId: string): Promise<{ sent: number; skipped?: string }> {
    const n = await this.prisma.notification.findUnique({ where: { id: notificationId } });
    if (!n) return { sent: 0, skipped: 'GONE' };
    const [settings, devices, unread] = await Promise.all([
      this.prisma.userSettings.findUnique({ where: { userId: n.userId } }),
      this.prisma.device.findMany({ where: { userId: n.userId, fcmToken: { not: null } } }),
      this.prisma.notification.count({ where: { userId: n.userId, readAt: null } }),
    ]);
    if (!devices.length) return { sent: 0, skipped: 'NO_DEVICE' };
    if (!shouldPush(n.type, this.prefsOf(settings), this.localTime())) return { sent: 0, skipped: 'PREFERENCES' };
    const { title, body } = pushText(n.type, settings?.locale ?? 'fr');
    const payload = (n.payload ?? {}) as Record<string, unknown>;
    // FCM data values must be strings; the ids let the app open the right screen.
    const data: Record<string, string> = { notificationId: n.id, type: n.type, unread: String(unread) };
    for (const [k, v] of Object.entries(payload)) if (typeof v === 'string' && k.endsWith('Id')) data[k] = v;
    let sent = 0;
    for (const d of devices) {
      const r = await this.sender.send({ token: d.fcmToken!, title, body, data });
      if (r === 'SENT') sent++;
      if (r === 'INVALID_TOKEN') await this.prisma.device.update({ where: { id: d.id }, data: { fcmToken: null } });
    }
    return { sent };
  }

  /** Business-calendar (Africa/Tunis) wall-clock time, "HH:MM". */
  private localTime(): string {
    const now = this.clock.now();
    const m = Math.floor((now.getTime() - this.calendar.dayStart(now).getTime()) / 60_000);
    return `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
  }

  // ───────────── Devices and preferences ─────────────

  async registerDevice(userId: string, d: { installId: string; platform: Platform; fcmToken?: string | null; appVersion?: string }): Promise<void> {
    // A token belongs to one install: if another account used it on this phone, that account stops receiving.
    if (d.fcmToken) await this.prisma.device.updateMany({ where: { fcmToken: d.fcmToken, NOT: { userId, installId: d.installId } }, data: { fcmToken: null } });
    const now = this.clock.now();
    await this.prisma.device.upsert({
      where: { userId_installId: { userId, installId: d.installId } },
      create: { id: uuidv7(), userId, installId: d.installId, platform: d.platform, fcmToken: d.fcmToken ?? null, appVersion: d.appVersion ?? null, lastSeenAt: now },
      update: { platform: d.platform, fcmToken: d.fcmToken ?? null, appVersion: d.appVersion ?? null, lastSeenAt: now },
    });
  }

  async removeDevice(userId: string, installId: string): Promise<void> {
    await this.prisma.device.deleteMany({ where: { userId, installId } });
  }

  async preferences(userId: string): Promise<PushPrefs> {
    return this.prefsOf(await this.prisma.userSettings.findUnique({ where: { userId } }));
  }

  async setPreferences(userId: string, p: { categories?: Partial<Record<PushCategory, boolean>>; quietHours?: { start: string; end: string } | null }): Promise<PushPrefs> {
    const current = await this.preferences(userId);
    const updates = Object.entries(p.categories ?? {}).filter(([k, v]) => (PUSH_CATEGORIES as readonly string[]).includes(k) && typeof v === 'boolean');
    const categories = { ...current.categories, ...Object.fromEntries(updates) };
    const quiet = p.quietHours === undefined ? current.quietHours : p.quietHours;
    const data = { notificationPrefs: { categories }, quietHoursStart: quiet ? timeCol(quiet.start) : null, quietHoursEnd: quiet ? timeCol(quiet.end) : null };
    await this.prisma.userSettings.upsert({ where: { userId }, create: { userId, ...data }, update: data });
    return this.preferences(userId);
  }

  private prefsOf(s: { notificationPrefs: unknown; quietHoursStart: Date | null; quietHoursEnd: Date | null } | null): PushPrefs {
    const start = hhmm(s?.quietHoursStart ?? null);
    const end = hhmm(s?.quietHoursEnd ?? null);
    return normalisePrefs(s?.notificationPrefs, start && end ? { start, end } : null);
  }
}
