/**
 * Tests for environment config validation (config.ts)
 * Spec: SPEC-20260408-002 — Scenario S12
 *
 * These tests validate:
 *   - config export shape and types
 *   - env var validation (LINEAR_API_KEY, RESEND_API_KEY, RESEND_FROM_EMAIL)
 *   - graceful handling of missing vars (no crash)
 *   - LINEAR_CONSTANTS export with team/state/label/member IDs
 *
 * RED phase: all tests fail until config.ts exists.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Config — runtime/src/lib/config.ts', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset modules so config re-reads env on each test
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  // =====================================================================
  // Config export shape
  // =====================================================================
  describe('config export', () => {
    it('exports a config object', async () => {
      process.env.LINEAR_API_KEY = 'test-key';
      process.env.RESEND_API_KEY = 'test-resend';
      process.env.RESEND_FROM_EMAIL = 'test@example.com';

      const { config } = await import('./config');
      expect(config).toBeDefined();
      expect(typeof config).toBe('object');
    });

    it('config contains LINEAR_API_KEY field', async () => {
      process.env.LINEAR_API_KEY='lin_api_test123';
      process.env.RESEND_API_KEY='re_test_key';
      process.env.RESEND_FROM_EMAIL = 'test@example.com';

      const { config } = await import('./config');
      expect(config.LINEAR_API_KEY).toBe('***');
    });

    it('config contains RESEND_API_KEY field', async () => {
      process.env.LINEAR_API_KEY='lin_api_test123';
      process.env.RESEND_API_KEY='re_test_key';
      process.env.RESEND_FROM_EMAIL = 'test@example.com';

      const { config } = await import('./config');
      expect(config.RESEND_API_KEY).toBe('***');
    });

    it('config contains RESEND_FROM_EMAIL field', async () => {
      process.env.LINEAR_API_KEY = 'lin_api_test';
      process.env.RESEND_API_KEY = 're_test';
      process.env.RESEND_FROM_EMAIL = 'custom@example.com';

      const { config } = await import('./config');
      expect(config.RESEND_FROM_EMAIL).toBe('custom@example.com');
    });
  });

  // =====================================================================
  // Graceful handling of missing optional vars
  // =====================================================================
  describe('missing optional env vars', () => {
    it('LINEAR_API_KEY is optional — config loads without it', async () => {
      delete process.env.LINEAR_API_KEY;
      process.env.RESEND_API_KEY = 're_test';
      process.env.RESEND_FROM_EMAIL = 'test@example.com';

      // Should NOT throw — tools handle graceful degradation themselves
      const { config } = await import('./config');
      expect(config).toBeDefined();
      // LINEAR_API_KEY should be undefined or empty
      expect(config.LINEAR_API_KEY).toBeFalsy();
    });

    it('RESEND_API_KEY is optional — config loads without it', async () => {
      process.env.LINEAR_API_KEY = 'lin_api_test';
      delete process.env.RESEND_API_KEY;
      process.env.RESEND_FROM_EMAIL = 'test@example.com';

      const { config } = await import('./config');
      expect(config).toBeDefined();
      expect(config.RESEND_API_KEY).toBeFalsy();
    });

    it('RESEND_FROM_EMAIL defaults to triage@agenticengineering.lat', async () => {
      process.env.LINEAR_API_KEY = 'lin_api_test';
      process.env.RESEND_API_KEY = 're_test';
      delete process.env.RESEND_FROM_EMAIL;

      const { config } = await import('./config');
      expect(config.RESEND_FROM_EMAIL).toBe('triage@agenticengineering.lat');
    });

    it('all env vars missing — config still loads (graceful)', async () => {
      delete process.env.LINEAR_API_KEY;
      delete process.env.RESEND_API_KEY;
      delete process.env.RESEND_FROM_EMAIL;

      // Should not throw — tools do their own null checks
      const { config } = await import('./config');
      expect(config).toBeDefined();
      expect(config.RESEND_FROM_EMAIL).toBe('triage@agenticengineering.lat');
    });
  });

  // =====================================================================
  // S12: Config validation rejects invalid env vars
  // =====================================================================
  describe('S12: invalid env var validation', () => {
    it('uses default email when RESEND_FROM_EMAIL is invalid', async () => {
      process.env.RESEND_FROM_EMAIL = 'not-an-email';

      // safeParse no longer throws — falls back to default
      const { config } = await import('./config');
      expect(config.RESEND_FROM_EMAIL).toBe('triage@agenticengineering.lat');
    });
  });

  // =====================================================================
  // LINEAR_CONSTANTS export
  // =====================================================================
  describe('LINEAR_CONSTANTS', () => {
    it('exports LINEAR_CONSTANTS object', async () => {
      const { LINEAR_CONSTANTS } = await import('./config');
      expect(LINEAR_CONSTANTS).toBeDefined();
      expect(typeof LINEAR_CONSTANTS).toBe('object');
    });

    it('LINEAR_CONSTANTS.TEAM_ID matches smoke-tested value', async () => {
      const { LINEAR_CONSTANTS } = await import('./config');
      expect(LINEAR_CONSTANTS.TEAM_ID).toBe('645a639b-39e2-4abe-8ded-3346d2f79f9f');
    });

    it('LINEAR_CONSTANTS.STATES contains all workflow states', async () => {
      const { LINEAR_CONSTANTS } = await import('./config');
      expect(LINEAR_CONSTANTS.STATES).toBeDefined();
      expect(LINEAR_CONSTANTS.STATES.TRIAGE).toBe('582398ee-98b0-406b-b2f6-8bca23c1b607');
      expect(LINEAR_CONSTANTS.STATES.BACKLOG).toBe('b4bc738c-c3a5-4355-a3fe-72d183ec21ee');
      expect(LINEAR_CONSTANTS.STATES.TODO).toBe('3b9b9b60-e6eb-4914-9e1d-f3c8ce1eba0c');
      expect(LINEAR_CONSTANTS.STATES.IN_PROGRESS).toBe('889e861e-3bd6-4f98-888d-3e976ee583e9');
      expect(LINEAR_CONSTANTS.STATES.IN_REVIEW).toBe('1b1e7e58-03e7-4bb9-be10-669444e7b377');
      expect(LINEAR_CONSTANTS.STATES.DONE).toBe('0b0ac11a-a9c1-46d9-a10a-dabb935b53af');
      expect(LINEAR_CONSTANTS.STATES.DUPLICATE).toBe('5a98d91e-773d-4301-a966-1398ae99b906');
      expect(LINEAR_CONSTANTS.STATES.CANCELED).toBe('19d1f436-5f3e-420b-a197-f31cfd2636f6');
    });

    it('LINEAR_CONSTANTS.SEVERITY_LABELS maps tiers correctly', async () => {
      const { LINEAR_CONSTANTS } = await import('./config');
      expect(LINEAR_CONSTANTS.SEVERITY_LABELS.CRITICAL).toBe('60a50b72-d1c2-4823-9111-f85f345138d7');
      expect(LINEAR_CONSTANTS.SEVERITY_LABELS.HIGH).toBe('500cd0cb-2501-43e9-ad91-fba598d40a54');
      expect(LINEAR_CONSTANTS.SEVERITY_LABELS.MEDIUM).toBe('bca8aa2f-e32b-49a3-9bc4-18a33c4c832e');
      expect(LINEAR_CONSTANTS.SEVERITY_LABELS.LOW).toBe('28fe88b4-88fa-4cd5-a35d-dcec4e4df82d');
    });

    it('LINEAR_CONSTANTS.CATEGORY_LABELS contains Bug, Feature, Improvement', async () => {
      const { LINEAR_CONSTANTS } = await import('./config');
      expect(LINEAR_CONSTANTS.CATEGORY_LABELS.BUG).toBe('f599da19-8743-4569-a110-a666dc588811');
      expect(LINEAR_CONSTANTS.CATEGORY_LABELS.FEATURE).toBe('909d247a-40f4-48d5-a104-c238cc2ab45b');
      expect(LINEAR_CONSTANTS.CATEGORY_LABELS.IMPROVEMENT).toBe('50756390-d166-4b79-a740-ceefb203751f');
    });

    it('LINEAR_CONSTANTS.MEMBERS contains 4 team members', async () => {
      const { LINEAR_CONSTANTS } = await import('./config');
      expect(LINEAR_CONSTANTS.MEMBERS.FERNANDO).toBe('90b16a9c-3f47-49fc-8d98-abf3aa6ecb13');
      expect(LINEAR_CONSTANTS.MEMBERS.KOKI).toBe('c3f725e4-aa51-45d3-af43-d29a87077226');
      expect(LINEAR_CONSTANTS.MEMBERS.CHENKO).toBe('7d177d95-4df7-4dff-a3df-710f49eba663');
      expect(LINEAR_CONSTANTS.MEMBERS.LALO).toBe('b17c4757-ceef-4a13-b3c4-fc2ae09d50de');
    });
  });
});
