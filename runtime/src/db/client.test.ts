/**
 * Unit tests for Drizzle client module (runtime/src/db/client.ts)
 * Spec: SPEC-20260409-001 — REQ-DB14
 *
 * Validates:
 *   - db and client are exported and defined
 *   - db has standard Drizzle query methods (select, insert, update, delete)
 *   - Default URL fallback to http://libsql:8080 when LIBSQL_URL not set
 *   - Custom LIBSQL_URL from environment is respected
 *   - Logger enabled when NODE_ENV=development
 *   - Connection error propagates on query without server
 *
 * Mocking: @libsql/client createClient and drizzle-orm/libsql drizzle
 * RED phase: all tests fail until client.ts is implemented.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be hoisted before any import of the module under test
// ---------------------------------------------------------------------------
const mockExecute = vi.fn();
const mockBatch = vi.fn();
const mockRawClient = { execute: mockExecute, batch: mockBatch };
const mockCreateClient = vi.fn().mockReturnValue(mockRawClient);

const mockDbInstance = {
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};
const mockDrizzle = vi.fn().mockReturnValue(mockDbInstance);

vi.mock('@libsql/client', () => ({ createClient: mockCreateClient }));
vi.mock('drizzle-orm/libsql', () => ({ drizzle: mockDrizzle }));

describe('REQ-DB14: Drizzle Client Module', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    // Ensure clean env for each test
    delete process.env.LIBSQL_URL;
    delete process.env.NODE_ENV;
  });

  afterEach(() => {
    // Restore original env
    process.env = { ...originalEnv };
  });

  // =========================================================================
  // Happy path: exports
  // =========================================================================
  describe('exports', () => {
    it('exports db and client that are defined', async () => {
      const mod = await import('./client');
      expect(mod.db).toBeDefined();
      expect(mod.client).toBeDefined();
    });

    it('db is the drizzle instance returned by drizzle()', async () => {
      const mod = await import('./client');
      expect(mod.db).toBe(mockDbInstance);
    });

    it('client is the raw libsql client returned by createClient()', async () => {
      const mod = await import('./client');
      expect(mod.client).toBe(mockRawClient);
    });
  });

  // =========================================================================
  // Happy path: Drizzle methods
  // =========================================================================
  describe('Drizzle query methods', () => {
    it('db has select method', async () => {
      const mod = await import('./client');
      expect(typeof mod.db.select).toBe('function');
    });

    it('db has insert method', async () => {
      const mod = await import('./client');
      expect(typeof mod.db.insert).toBe('function');
    });

    it('db has update method', async () => {
      const mod = await import('./client');
      expect(typeof mod.db.update).toBe('function');
    });

    it('db has delete method', async () => {
      const mod = await import('./client');
      expect(typeof mod.db.delete).toBe('function');
    });
  });

  // =========================================================================
  // Edge: Default URL fallback
  // =========================================================================
  describe('default URL fallback', () => {
    it('uses http://libsql:8080 when LIBSQL_URL is not set', async () => {
      delete process.env.LIBSQL_URL;
      await import('./client');

      expect(mockCreateClient).toHaveBeenCalledTimes(1);
      const callArg = mockCreateClient.mock.calls[0][0];
      expect(callArg.url).toBe('http://libsql:8080');
    });
  });

  // =========================================================================
  // Edge: Custom URL from environment
  // =========================================================================
  describe('custom LIBSQL_URL', () => {
    it('passes LIBSQL_URL from env to createClient', async () => {
      process.env.LIBSQL_URL = 'http://custom-host:9999';
      await import('./client');

      expect(mockCreateClient).toHaveBeenCalledTimes(1);
      const callArg = mockCreateClient.mock.calls[0][0];
      expect(callArg.url).toBe('http://custom-host:9999');
    });
  });

  // =========================================================================
  // Edge: Logger in development mode
  // =========================================================================
  describe('development logger', () => {
    it('enables logger when NODE_ENV=development', async () => {
      process.env.NODE_ENV = 'development';
      await import('./client');

      expect(mockDrizzle).toHaveBeenCalledTimes(1);
      const drizzleArgs = mockDrizzle.mock.calls[0];
      // drizzle(client, { logger: true }) — second arg should have logger: true
      const opts = drizzleArgs[1];
      expect(opts).toBeDefined();
      expect(opts.logger).toBe(true);
    });

    it('does not enable logger when NODE_ENV=production', async () => {
      process.env.NODE_ENV = 'production';
      await import('./client');

      expect(mockDrizzle).toHaveBeenCalledTimes(1);
      const opts = mockDrizzle.mock.calls[0][1];
      // logger should be falsy or absent
      expect(!opts || !opts.logger).toBe(true);
    });

    it('does not enable logger when NODE_ENV is not set', async () => {
      delete process.env.NODE_ENV;
      await import('./client');

      expect(mockDrizzle).toHaveBeenCalledTimes(1);
      const opts = mockDrizzle.mock.calls[0][1];
      expect(!opts || !opts.logger).toBe(true);
    });
  });

  // =========================================================================
  // Error: Query without server
  // =========================================================================
  describe('connection error handling', () => {
    it('propagates connection error on query attempt without server', async () => {
      // Simulate execute throwing a connection error
      const connError = new Error('CONNECTION_REFUSED: Failed to connect');
      mockExecute.mockRejectedValueOnce(connError);

      const mod = await import('./client');

      // Attempting a raw query on the client should throw
      await expect(mod.client.execute('SELECT 1')).rejects.toThrow(
        /CONNECTION_REFUSED|Failed to connect/,
      );
    });
  });

  // =========================================================================
  // createClient is called with the raw client passed to drizzle
  // =========================================================================
  describe('wiring', () => {
    it('passes the createClient result to drizzle()', async () => {
      await import('./client');

      expect(mockDrizzle).toHaveBeenCalledTimes(1);
      const firstArg = mockDrizzle.mock.calls[0][0];
      expect(firstArg).toBe(mockRawClient);
    });
  });
});
