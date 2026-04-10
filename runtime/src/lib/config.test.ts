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
      const { config } = await import('./config');
      expect(config).toHaveProperty('LINEAR_API_KEY');
      // Value comes from vitest env or process.env — must be string or undefined
      expect(
        typeof config.LINEAR_API_KEY === 'string' ||
        config.LINEAR_API_KEY === undefined
      ).toBe(true);
    });

    it('config contains RESEND_API_KEY field', async () => {
      const { config } = await import('./config');
      expect(config).toHaveProperty('RESEND_API_KEY');
      expect(
        typeof config.RESEND_API_KEY === 'string' ||
        config.RESEND_API_KEY === undefined
      ).toBe(true);
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
      expect(LINEAR_CONSTANTS.STATES.TRIAGE).toBe('bce0cec5-80ba-407e-aa98-248c380ce966');
      expect(LINEAR_CONSTANTS.STATES.BACKLOG).toBe('a1b56fee-32c7-4c7d-b6cd-318380590a53');
      expect(LINEAR_CONSTANTS.STATES.TODO).toBe('52a97f3f-481b-40f9-8187-237dc282a47d');
      expect(LINEAR_CONSTANTS.STATES.IN_PROGRESS).toBe('3aba585d-1838-4a0e-9651-c4a2c9032dfb');
      expect(LINEAR_CONSTANTS.STATES.IN_REVIEW).toBe('3425bc21-40e6-457d-9b8a-4386e0509d79');
      expect(LINEAR_CONSTANTS.STATES.DONE).toBe('40c24407-f5d5-4489-b5ac-ef964373d954');
      expect(LINEAR_CONSTANTS.STATES.DUPLICATE).toBe('9f2f1444-3a4b-46db-858c-f643a6d5aecb');
      expect(LINEAR_CONSTANTS.STATES.CANCELED).toBe('6ff262e3-d016-4777-836b-1357cd535f73');
    });

    it('LINEAR_CONSTANTS.SEVERITY_LABELS maps tiers correctly', async () => {
      const { LINEAR_CONSTANTS } = await import('./config');
      expect(LINEAR_CONSTANTS.SEVERITY_LABELS.CRITICAL).toBe('47785580-5256-4240-9f11-cde67e06a4c3');
      expect(LINEAR_CONSTANTS.SEVERITY_LABELS.HIGH).toBe('eef1c6e5-f3c0-4b0f-9702-189748af77f0');
      expect(LINEAR_CONSTANTS.SEVERITY_LABELS.MEDIUM).toBe('bd743933-cd2f-4b05-a832-669aefb2af77');
      expect(LINEAR_CONSTANTS.SEVERITY_LABELS.LOW).toBe('f4350e9c-96ea-44f8-931a-4af52aacf3ed');
    });

    it('LINEAR_CONSTANTS.CATEGORY_LABELS contains Bug, Feature, Improvement', async () => {
      const { LINEAR_CONSTANTS } = await import('./config');
      expect(LINEAR_CONSTANTS.CATEGORY_LABELS.BUG).toBe('f599da19-8743-4569-a110-a666dc588811');
      expect(LINEAR_CONSTANTS.CATEGORY_LABELS.FEATURE).toBe('909d247a-40f4-48d5-a104-c238cc2ab45b');
      expect(LINEAR_CONSTANTS.CATEGORY_LABELS.IMPROVEMENT).toBe('50756390-d166-4b79-a740-ceefb203751f');
    });

    it('LINEAR_CONSTANTS.MEMBERS contains 4 team members with linearId and name', async () => {
      const { LINEAR_CONSTANTS } = await import('./config');
      expect(LINEAR_CONSTANTS.MEMBERS.FERNANDO.linearId).toBe('90b16a9c-3f47-49fc-8d98-abf3aa6ecb13');
      expect(LINEAR_CONSTANTS.MEMBERS.KOKI.linearId).toBe('c3f725e4-aa51-45d3-af43-d29a87077226');
      expect(LINEAR_CONSTANTS.MEMBERS.CHENKO.linearId).toBe('7d177d95-4df7-4dff-a3df-710f49eba663');
      expect(LINEAR_CONSTANTS.MEMBERS.LALO.linearId).toBe('b17c4757-ceef-4a13-b3c4-fc2ae09d50de');
      expect(LINEAR_CONSTANTS.MEMBERS.FERNANDO.name).toBe('Fernando');
    });
  });
});
