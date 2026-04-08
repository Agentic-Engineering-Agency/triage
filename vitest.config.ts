import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'runtime/src/**/*.test.ts'],
    // Test-only mock values — no real API calls are made.
    // These satisfy config validation in runtime unit tests.
    env: {
      LINEAR_API_KEY: 'test-linear-key',
      RESEND_API_KEY: 'test-resend-key',
      RESEND_FROM_EMAIL: 'triage@agenticengineering.lat',
    },
  },
});
