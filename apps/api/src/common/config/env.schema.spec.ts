import { loadEnv } from './env.schema';

const valid = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  CURSOR_HMAC_SECRET: 'x'.repeat(32),
  JWT_PRIVATE_KEY_B64: 'p'.repeat(40),
  JWT_PUBLIC_KEY_B64: 'q'.repeat(40),
  HEALTH_DATA_KEYS: `k1:${Buffer.alloc(32, 1).toString('base64')}`,
};

describe('loadEnv', () => {
  it('applies defaults', () => {
    const env = loadEnv(valid);
    expect(env.PORT).toBe(3000);
    expect(env.APP_NAME).toBe('Fitness League');
    expect(env.CORS_ORIGINS).toEqual([]);
    expect(env.OPENAPI_ENABLED).toBe(false);
  });

  it('parses lists and booleans', () => {
    const env = loadEnv({ ...valid, CORS_ORIGINS: 'http://a.test, http://b.test', OPENAPI_ENABLED: 'true' });
    expect(env.CORS_ORIGINS).toEqual(['http://a.test', 'http://b.test']);
    expect(env.OPENAPI_ENABLED).toBe(true);
  });

  it('validates health-data keys (32 bytes each)', () => {
    expect(loadEnv(valid).HEALTH_DATA_KEYS[0]?.id).toBe('k1');
    expect(() => loadEnv({ ...valid, HEALTH_DATA_KEYS: 'k1:c2hvcnQ=' })).toThrow(/HEALTH_DATA_KEYS/);
  });

  it('defaults to local media storage and requires S3 credentials for the s3 driver', () => {
    expect(loadEnv(valid)).toMatchObject({ STORAGE_DRIVER: 'local', MEDIA_PUBLIC_BASE_URL: 'http://localhost:3000/api/v1/media' });
    expect(() => loadEnv({ ...valid, STORAGE_DRIVER: 's3' })).toThrow(/S3_BUCKET: required when STORAGE_DRIVER=s3/);
    expect(loadEnv({ ...valid, STORAGE_DRIVER: 's3', S3_BUCKET: 'b', S3_ACCESS_KEY: 'k', S3_SECRET_KEY: 's' }).STORAGE_DRIVER).toBe('s3');
  });

  it('accepts a static dev 2FA code outside production only', () => {
    expect(loadEnv({ ...valid, DEV_STATIC_TOTP_CODE: '000000' }).DEV_STATIC_TOTP_CODE).toBe('000000');
    expect(() => loadEnv({ ...valid, DEV_STATIC_TOTP_CODE: '12ab' })).toThrow(/DEV_STATIC_TOTP_CODE/);
    expect(() => loadEnv({ ...valid, NODE_ENV: 'production', DEV_STATIC_TOTP_CODE: '000000' })).toThrow(/not allowed when NODE_ENV=production/);
  });

  it('refuses to start without required secrets, naming every problem', () => {
    expect(() => loadEnv({ DATABASE_URL: 'nope' })).toThrow(/DATABASE_URL[\s\S]*CURSOR_HMAC_SECRET/);
  });
});
