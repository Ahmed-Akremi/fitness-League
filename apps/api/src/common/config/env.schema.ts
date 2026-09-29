import { z } from 'zod';

const bool = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

/** Every environment variable the API reads. The process refuses to start if this does not validate. */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_NAME: z.string().min(1).default('Fitness League'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().optional(),
  /** Signs pagination cursors so clients cannot forge them. */
  CURSOR_HMAC_SECRET: z.string().min(32),
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),
  BUSINESS_UTC_OFFSET_MINUTES: z.coerce.number().int().min(-720).max(840).default(60),
  OPENAPI_ENABLED: bool,
  RATE_LIMIT_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),

  /** Ed25519 PEM keys, base64-encoded on one line. Generate with `pnpm keys:generate`. */
  JWT_PRIVATE_KEY_B64: z.string().min(40),
  JWT_PUBLIC_KEY_B64: z.string().min(40),
  JWT_KEY_ID: z.string().min(1).default('k1'),
  JWT_ISSUER: z.string().min(1).default('fitness-league'),
  ACCESS_TOKEN_TTL_S: z.coerce.number().int().min(60).max(3600).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),

  /** smtp://user:pass@host:port — mailpit locally (smtp://localhost:1025). Empty = log-only (dev/test). */
  SMTP_URL: z.string().default(''),
  MAIL_FROM: z.string().default('Fitness League <no-reply@fitnessleague.app>'),
  /** OAuth audiences (comma-separated client ids). Empty = that provider is disabled. */
  GOOGLE_CLIENT_IDS: z
    .string()
    .default('')
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),
  APPLE_CLIENT_IDS: z
    .string()
    .default('')
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),

  /**
   * Health-data encryption keys (AES-256-GCM), `keyId:base64key` comma-separated; the first is used to encrypt,
   * all are accepted to decrypt (rotation). Generate a key with `openssl rand -base64 32`.
   */
  HEALTH_DATA_KEYS: z
    .string()
    .min(1)
    .transform((v, ctx) => {
      const keys = v.split(',').map((pair) => {
        const [id, b64] = pair.trim().split(':');
        return { id: id ?? '', key: Buffer.from(b64 ?? '', 'base64') };
      });
      if (keys.some((k) => !k.id || k.key.length !== 32)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'expected keyId:base64(32 bytes)[,…]' });
        return z.NEVER;
      }
      return keys;
    }),

  /**
   * DEV ONLY: a fixed 6-digit code accepted as the admin second factor (and skipping authenticator enrolment).
   * Refused at boot when NODE_ENV=production.
   */
  DEV_STATIC_TOTP_CODE: z
    .string()
    .regex(/^\d{6}$/, 'must be 6 digits')
    .optional(),

  /** Media storage: `local` (dev, files served by /media) or `s3` (MinIO/S3 + CDN). */
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().optional(),
  /** Public base URL of stored media, without trailing slash. */
  MEDIA_PUBLIC_BASE_URL: z.string().url().default('http://localhost:3000/api/v1/media'),
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),

  /** Push notifications: `log` (dev, nothing leaves the server) or `fcm` (Firebase HTTP v1 with a service account). */
  PUSH_DRIVER: z.enum(['log', 'fcm']).default('log'),
  FCM_PROJECT_ID: z.string().optional(),
  FCM_CLIENT_EMAIL: z.string().email().optional(),
  /** PEM private key of the service account; `\n` escapes are accepted. */
  FCM_PRIVATE_KEY: z.string().optional(),

  /** Base for links in emails; the app handles them as deep links. */
  APP_LINK_BASE_URL: z.string().url().default('https://app.fitnessleague.app'),
});

export type Env = z.infer<typeof envSchema>;

/** Settings that must never reach production. */
function assertSafeForEnvironment(env: Env): string[] {
  const problems: string[] = [];
  if (env.NODE_ENV === 'production' && env.DEV_STATIC_TOTP_CODE) problems.push('  - DEV_STATIC_TOTP_CODE: not allowed when NODE_ENV=production');
  if (env.STORAGE_DRIVER === 's3') {
    for (const k of ['S3_BUCKET', 'S3_ACCESS_KEY', 'S3_SECRET_KEY'] as const) if (!env[k]) problems.push(`  - ${k}: required when STORAGE_DRIVER=s3`);
  }
  if (env.PUSH_DRIVER === 'fcm') {
    for (const k of ['FCM_PROJECT_ID', 'FCM_CLIENT_EMAIL', 'FCM_PRIVATE_KEY'] as const) if (!env[k]) problems.push(`  - ${k}: required when PUSH_DRIVER=fcm`);
  }
  return problems;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const unsafe = assertSafeForEnvironment(parsed.data);
  // The default points at localhost: production must say where media are really served from.
  if (parsed.data.NODE_ENV === 'production' && !source.MEDIA_PUBLIC_BASE_URL) unsafe.push('  - MEDIA_PUBLIC_BASE_URL: required when NODE_ENV=production');
  if (unsafe.length) throw new Error(`Invalid environment configuration:\n${unsafe.join('\n')}`);
  return parsed.data;
}
