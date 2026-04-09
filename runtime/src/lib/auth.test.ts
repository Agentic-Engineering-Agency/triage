/**
 * Unit tests for Better Auth instance (runtime/src/lib/auth.ts)
 * Spec: SPEC-20260409-001 — REQ-DB16
 *
 * Validates:
 *   - auth is exported and defined
 *   - auth.handler is a function (HTTP request handling)
 *   - Module doesn't throw on import with dev defaults
 *   - basePath is '/auth'
 *   - Drizzle adapter provider is 'sqlite' not 'turso'
 *
 * Mocking: db client, schema, better-auth, and drizzle-adapter.
 * RED phase: all tests fail until auth.ts is implemented.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be declared before any import of the module under test
// ---------------------------------------------------------------------------

// Mock the db client module
vi.mock('../db/client', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  client: {
    execute: vi.fn(),
    batch: vi.fn(),
  },
}));

// Mock the schema module (provide minimal table stubs)
vi.mock('../db/schema', () => ({
  authUser: { id: {} },
  authSession: { id: {} },
  authAccount: { id: {} },
  authVerification: { id: {} },
  wikiDocuments: { id: {} },
  wikiChunks: { id: {} },
  localTickets: { id: {} },
}));

// Track betterAuth calls to inspect config
let capturedBetterAuthConfig: Record<string, unknown> | null = null;

const mockHandler = vi.fn();
const mockApi = {};
const mockAuthInstance = {
  handler: mockHandler,
  api: mockApi,
  options: {},
};

vi.mock('better-auth', () => ({
  betterAuth: vi.fn((config: Record<string, unknown>) => {
    capturedBetterAuthConfig = config;
    return mockAuthInstance;
  }),
}));

// Track drizzleAdapter calls to inspect config
let capturedDrizzleAdapterArgs: unknown[] = [];

vi.mock('@better-auth/drizzle-adapter', () => ({
  drizzleAdapter: vi.fn((...args: unknown[]) => {
    capturedDrizzleAdapterArgs = args;
    return { adapter: 'drizzle-mock' };
  }),
}));

describe('REQ-DB16: Better Auth Instance', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    capturedBetterAuthConfig = null;
    capturedDrizzleAdapterArgs = [];
    // Provide dev defaults so the module doesn't crash on missing secrets
    process.env.BETTER_AUTH_SECRET =
      process.env.BETTER_AUTH_SECRET || 'dev-secret-for-testing-min32chars!!!';
    process.env.BETTER_AUTH_URL =
      process.env.BETTER_AUTH_URL || 'http://localhost:4111';
    // Ensure not production by default
    delete process.env.NODE_ENV;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  // =========================================================================
  // Happy: auth exported and defined
  // =========================================================================
  describe('exports', () => {
    it('exports auth that is defined', async () => {
      const mod = await import('./auth');
      expect(mod.auth).toBeDefined();
    });

    it('auth is an object', async () => {
      const mod = await import('./auth');
      expect(typeof mod.auth).toBe('object');
    });
  });

  // =========================================================================
  // Happy: auth.handler is a function
  // =========================================================================
  describe('handler', () => {
    it('auth.handler is defined', async () => {
      const mod = await import('./auth');
      expect(mod.auth.handler).toBeDefined();
    });

    it('auth.handler is a function', async () => {
      const mod = await import('./auth');
      expect(typeof mod.auth.handler).toBe('function');
    });
  });

  // =========================================================================
  // Edge: basePath is '/auth'
  // =========================================================================
  describe('basePath configuration', () => {
    it('betterAuth is called with basePath "/auth"', async () => {
      await import('./auth');
      expect(capturedBetterAuthConfig).toBeDefined();
      expect(capturedBetterAuthConfig!.basePath).toBe('/auth');
    });
  });

  // =========================================================================
  // Edge: Drizzle adapter provider is 'sqlite'
  // =========================================================================
  describe('drizzle adapter', () => {
    it('drizzleAdapter is called with provider "sqlite"', async () => {
      await import('./auth');
      expect(capturedDrizzleAdapterArgs.length).toBeGreaterThanOrEqual(2);
      const adapterOpts = capturedDrizzleAdapterArgs[1] as Record<
        string,
        unknown
      >;
      expect(adapterOpts).toBeDefined();
      expect(adapterOpts.provider).toBe('sqlite');
    });

    it('drizzleAdapter provider is NOT "turso"', async () => {
      await import('./auth');
      const adapterOpts = capturedDrizzleAdapterArgs[1] as Record<
        string,
        unknown
      >;
      expect(adapterOpts.provider).not.toBe('turso');
    });
  });

  // =========================================================================
  // Module doesn't throw on import (with dev defaults)
  // =========================================================================
  describe('import safety', () => {
    it('module imports without throwing when dev env vars are set', async () => {
      process.env.BETTER_AUTH_SECRET = 'test-secret-for-unit-tests-min32chars!!!';
      process.env.BETTER_AUTH_URL = 'http://localhost:4111';
      delete process.env.NODE_ENV;

      // Should not throw
      const mod = await import('./auth');
      expect(mod.auth).toBeDefined();
    });
  });

  // =========================================================================
  // Error: Missing BETTER_AUTH_SECRET in production
  // =========================================================================
  describe('missing BETTER_AUTH_SECRET in production', () => {
    it('throws when BETTER_AUTH_SECRET is missing in production', async () => {
      delete process.env.BETTER_AUTH_SECRET;
      process.env.NODE_ENV = 'production';
      process.env.BETTER_AUTH_URL = 'https://prod.example.com';

      // The module should throw on import because of the IIFE that checks
      // for BETTER_AUTH_SECRET in production mode
      await expect(import('./auth')).rejects.toThrow(/BETTER_AUTH_SECRET/);
    });
  });

  // =========================================================================
  // DB is passed to drizzle adapter
  // =========================================================================
  describe('database wiring', () => {
    it('drizzleAdapter receives the db instance as first arg', async () => {
      await import('./auth');
      expect(capturedDrizzleAdapterArgs.length).toBeGreaterThanOrEqual(1);
      const dbArg = capturedDrizzleAdapterArgs[0];
      // The first arg should be the db object (from our mock)
      expect(dbArg).toBeDefined();
      expect(typeof dbArg).toBe('object');
    });

    it('drizzleAdapter receives schema with user/session/account/verification tables', async () => {
      await import('./auth');
      const adapterOpts = capturedDrizzleAdapterArgs[1] as Record<
        string,
        unknown
      >;
      const schema = adapterOpts.schema as Record<string, unknown>;
      expect(schema).toBeDefined();
      expect(schema.user).toBeDefined();
      expect(schema.session).toBeDefined();
      expect(schema.account).toBeDefined();
      expect(schema.verification).toBeDefined();
    });
  });
});
