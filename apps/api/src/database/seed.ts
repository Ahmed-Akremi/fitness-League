/**
 * Idempotent seed: Tunisia (24 governorates + cities), sports, metric types, exercises, divisions,
 * default scoring rule set v1 (+ expected progression), current & next season, First Step badge, sample gyms.
 * Safe to run repeatedly: everything is upserted by a stable business key.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DivisionCode, ExperienceLevel, GymStatus, LoggingMode, MetricDirection, PrismaClient, SportCategory, BadgeCategory } from '@prisma/client';
import { BusinessCalendar, TUNIS_UTC_OFFSET_MINUTES } from '../common/clock/business-calendar';
import { uuidv7 } from '../common/ids/uuid';
import { ruleSetConfigSchema } from '../modules/scoring/rule-set.schema';

type I18n = { fr: string; en: string; ar: string };

const SEED_DIR = process.env.SEED_DATA_DIR ?? join(__dirname, '../../../../infra/seed-data');
const readJson = <T>(file: string): T => JSON.parse(readFileSync(join(SEED_DIR, file), 'utf8')) as T;

export function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

interface TunisiaData {
  country: { code: string; name: I18n };
  governorates: { code: string; name: I18n; cities: [string, string][] }[];
}

interface CatalogData {
  metricTypes: { code: string; unit: string; direction: MetricDirection; name: I18n }[];
  sports: { code: string; category: SportCategory; loggingMode: LoggingMode; icon: string; name: I18n }[];
  exercises: {
    code: string;
    sport: string | null;
    equipment: string;
    bodyweight: boolean;
    metrics: string[];
    plausibility: Record<string, number>;
    name: I18n;
  }[];
  divisions: { code: DivisionCode; order: number; name: I18n }[];
  badges: { code: string; category: BadgeCategory; icon: string; rarity: string; rule: object; name: I18n; description: I18n }[];
  gyms: { slug: string; name: string; governorate: string; city: string; status: GymStatus; sports?: string[] }[];
}

interface RuleSetData {
  version: number;
  changeNote: string;
  config: unknown;
  expectedProgression: { level: ExperienceLevel; exercise: string | null; metric: string; pct: number }[];
}

async function seedLocations(prisma: PrismaClient, data: TunisiaData): Promise<void> {
  await prisma.country.upsert({
    where: { code: data.country.code },
    update: { nameI18n: data.country.name },
    create: { code: data.country.code, nameI18n: data.country.name },
  });
  for (const gov of data.governorates) {
    const g = await prisma.governorate.upsert({
      where: { code: gov.code },
      update: { nameI18n: gov.name },
      create: { id: uuidv7(), code: gov.code, countryCode: data.country.code, nameI18n: gov.name },
    });
    for (const [latin, arabic] of gov.cities) {
      const code = `${gov.code}-${slugify(latin)}`;
      const nameI18n = { fr: latin, en: latin, ar: arabic };
      await prisma.city.upsert({
        where: { code },
        update: { nameI18n },
        create: { id: uuidv7(), code, governorateId: g.id, nameI18n },
      });
    }
  }
}

async function seedCatalog(prisma: PrismaClient, data: CatalogData): Promise<void> {
  for (const m of data.metricTypes) {
    await prisma.metricType.upsert({
      where: { code: m.code },
      update: { unit: m.unit, direction: m.direction, nameI18n: m.name },
      create: { id: uuidv7(), code: m.code, unit: m.unit, direction: m.direction, nameI18n: m.name },
    });
  }
  for (const s of data.sports) {
    const fields = { category: s.category, loggingMode: s.loggingMode, icon: s.icon, nameI18n: s.name };
    await prisma.sport.upsert({ where: { code: s.code }, update: fields, create: { id: uuidv7(), code: s.code, ...fields } });
  }
  const sportIds = new Map((await prisma.sport.findMany()).map((s) => [s.code, s.id]));
  const metricCodes = new Set(data.metricTypes.map((m) => m.code));
  for (const e of data.exercises) {
    const unknown = e.metrics.filter((m) => !metricCodes.has(m));
    if (unknown.length) throw new Error(`Exercise ${e.code} references unknown metrics: ${unknown.join(', ')}`);
    const sportId = e.sport ? sportIds.get(e.sport) : null;
    if (e.sport && !sportId) throw new Error(`Exercise ${e.code} references unknown sport ${e.sport}`);
    const fields = {
      sportId,
      nameI18n: e.name,
      equipment: e.equipment,
      isBodyweight: e.bodyweight,
      trackedMetrics: e.metrics,
      plausibility: e.plausibility,
    };
    await prisma.exercise.upsert({ where: { code: e.code }, update: fields, create: { id: uuidv7(), code: e.code, ...fields } });
  }
  for (const b of data.badges) {
    const fields = {
      category: b.category,
      icon: b.icon,
      rarity: b.rarity,
      rule: b.rule,
      nameI18n: b.name,
      descriptionI18n: b.description,
    };
    await prisma.badge.upsert({ where: { code: b.code }, update: fields, create: { id: uuidv7(), code: b.code, ...fields } });
  }
}

async function seedRuleSet(prisma: PrismaClient, data: RuleSetData, divisions: CatalogData['divisions']): Promise<void> {
  const config = ruleSetConfigSchema.parse(data.config);
  const existing = await prisma.scoringRuleSet.findUnique({ where: { version: data.version } });
  // A published rule set is immutable: never overwrite it, even from the seed.
  const ruleSet =
    existing ??
    (await prisma.scoringRuleSet.create({
      data: {
        id: uuidv7(),
        version: data.version,
        status: (await prisma.scoringRuleSet.count({ where: { status: 'ACTIVE' } })) ? 'DRAFT' : 'ACTIVE',
        config,
        configHash: createHash('sha256').update(JSON.stringify(config)).digest(),
        changeNote: data.changeNote,
        activatedAt: new Date(),
      },
    }));

  if (!existing) {
    const exerciseIds = new Map((await prisma.exercise.findMany()).map((e) => [e.code, e.id]));
    const metricIds = new Map((await prisma.metricType.findMany()).map((m) => [m.code, m.id]));
    await prisma.expectedProgression.createMany({
      data: data.expectedProgression.map((row) => {
        const metricTypeId = metricIds.get(row.metric);
        if (!metricTypeId) throw new Error(`Unknown metric ${row.metric} in expected progression`);
        const exerciseId = row.exercise ? exerciseIds.get(row.exercise) : null;
        if (row.exercise && !exerciseId) throw new Error(`Unknown exercise ${row.exercise} in expected progression`);
        return {
          id: uuidv7(),
          ruleSetId: ruleSet.id,
          experienceLevel: row.level,
          exerciseId,
          metricTypeId,
          periodDays: config.progress_window_days,
          expectedPct: row.pct,
        };
      }),
    });
  }

  const active = await prisma.scoringRuleSet.findFirstOrThrow({ where: { status: 'ACTIVE' } });
  const thresholds = ruleSetConfigSchema.parse(active.config).division_thresholds;
  for (const d of divisions) {
    const fields = { order: d.order, minLp: thresholds[d.code]!, nameI18n: d.name };
    await prisma.division.upsert({ where: { code: d.code }, update: fields, create: { id: uuidv7(), code: d.code, ...fields } });
  }
}

async function seedSeasons(prisma: PrismaClient, now: Date): Promise<void> {
  const calendar = new BusinessCalendar(TUNIS_UTC_OFFSET_MINUTES);
  const current = calendar.quarterBounds(now);
  const next = calendar.quarterBounds(current.end);
  for (const [bounds, status] of [
    [current, 'ACTIVE'],
    [next, 'SCHEDULED'],
  ] as const) {
    const overlapping = await prisma.season.findFirst({
      where: { countryCode: 'TN', startsAt: { lt: bounds.end }, endsAt: { gt: bounds.start } },
    });
    if (overlapping) continue;
    const local = new Date(bounds.start.getTime() + TUNIS_UTC_OFFSET_MINUTES * 60_000);
    const name = `Season ${local.getUTCFullYear()} Q${Math.floor(local.getUTCMonth() / 3) + 1}`;
    await prisma.season.create({
      data: { id: uuidv7(), name, countryCode: 'TN', startsAt: bounds.start, endsAt: bounds.end, status },
    });
  }
}

async function seedGyms(prisma: PrismaClient, gyms: CatalogData['gyms']): Promise<void> {
  for (const gym of gyms) {
    const governorate = await prisma.governorate.findUniqueOrThrow({ where: { code: gym.governorate } });
    const city = await prisma.city.findUniqueOrThrow({ where: { code: `${gym.governorate}-${slugify(gym.city)}` } });
    const fields = {
      name: gym.name,
      governorateId: governorate.id,
      cityId: city.id,
      status: gym.status,
      verifiedAt: gym.status === 'VERIFIED' ? new Date() : null,
    };
    const row = await prisma.gym.upsert({ where: { slug: gym.slug }, update: fields, create: { id: uuidv7(), slug: gym.slug, ...fields } });
    if (gym.sports?.length) {
      const sportIds = (await prisma.sport.findMany({ where: { code: { in: gym.sports } } })).map((s) => s.id);
      await prisma.gymSport.createMany({ data: sportIds.map((sportId) => ({ gymId: row.id, sportId })), skipDuplicates: true });
    }
  }
}

export async function seed(prisma: PrismaClient, now = new Date()): Promise<void> {
  const catalog = readJson<CatalogData>('catalog.json');
  await seedLocations(prisma, readJson<TunisiaData>('tunisia.json'));
  await seedCatalog(prisma, catalog);
  await seedRuleSet(prisma, readJson<RuleSetData>('ruleset-v1.json'), catalog.divisions);
  await seedSeasons(prisma, now);
  await seedGyms(prisma, catalog.gyms);
}

if (require.main === module) {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const prisma = new PrismaClient();
  seed(prisma)
    .then(() => console.log('Seed completed.'))
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => void prisma.$disconnect());
}
