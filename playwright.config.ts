import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/fe-auth-pages',
  testMatch: '**/*.e2e.ts',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false, // auth tests must be sequential (shared state)
  retries: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3001',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
