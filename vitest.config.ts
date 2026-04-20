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
      // Slack + GitHub tokens wired after the multi-tenant refactor:
      // tools now resolve via tenant-keys (DB → process.env), so the old
      // `vi.mock('../../lib/config')` pattern no longer supplies these.
      SLACK_BOT_TOKEN: 'xoxb-test-token',
      SLACK_CHANNEL_ID: 'C_TEST_CHANNEL',
      GITHUB_TOKEN: 'ghp-test-token',
    },
  },
});
