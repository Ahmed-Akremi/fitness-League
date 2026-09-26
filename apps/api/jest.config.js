// Unit tests live next to the code (src/**/*.spec.ts); integration tests need a real Postgres (test/*.int-spec.ts).
const base = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
  testEnvironment: 'node',
};

module.exports = {
  // Integration hooks seed a real database; on slow disks (WSL /mnt/c) that exceeds the 5 s default.
  testTimeout: 60000,
  projects: [
    { ...base, displayName: 'unit', rootDir: 'src', testRegex: '.*\\.spec\\.ts$' },
    {
      ...base,
      displayName: 'integration',
      rootDir: '.',
      testRegex: 'test/.*\\.int-spec\\.ts$',
      globalSetup: '<rootDir>/test/setup/global-setup.ts',
      globalTeardown: '<rootDir>/test/setup/global-teardown.ts',
    },
  ],
};
