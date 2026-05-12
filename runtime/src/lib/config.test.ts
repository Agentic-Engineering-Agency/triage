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

    // STATES / SEVERITY_LABELS / CATEGORY_LABELS / MEMBERS were removed from
    // LINEAR_CONSTANTS when the TRI team migrated to SOL (commit 808f7fb) and
    // per-tenant Linear data became dynamic (multi-tenant arc). Only TEAM_ID
    // survives as a default fallback when LINEAR_TEAM_ID env var is unset.
    it('LINEAR_CONSTANTS.TEAM_ID defaults to the configured fallback', async () => {
      delete process.env.LINEAR_TEAM_ID;
      const { LINEAR_CONSTANTS } = await import('./config');
      expect(typeof LINEAR_CONSTANTS.TEAM_ID).toBe('string');
      expect(LINEAR_CONSTANTS.TEAM_ID.length).toBeGreaterThan(0);
    });
  });
});
