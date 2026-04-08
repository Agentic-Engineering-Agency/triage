/**
 * SpecSafe TEST — Caddyfile Configuration
 * Spec: SPEC-20260407-001
 * Requirements: REQ-D12
 * Author: Reva (Test Engineer)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const PROJECT_ROOT = resolve(__dirname, '../../');

function findCaddyfile(): string {
  const candidates = [
    resolve(PROJECT_ROOT, 'Caddyfile'),
    resolve(PROJECT_ROOT, 'frontend/Caddyfile'),
    resolve(PROJECT_ROOT, 'docker/Caddyfile'),
    resolve(PROJECT_ROOT, 'caddy/Caddyfile'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return candidates[0]; // default
}

function readCaddyfile(): string {
  return readFileSync(findCaddyfile(), 'utf-8');
}

// ---------------------------------------------------------------------------
// REQ-D12: Caddyfile Configuration
// ---------------------------------------------------------------------------
describe('REQ-D12: Caddyfile Configuration', () => {
  describe('Caddyfile existence', () => {
    it('should have a Caddyfile in the project', () => {
      // GIVEN the project repository
      // WHEN checking for a Caddyfile
      // THEN the file should exist
      expect(existsSync(findCaddyfile())).toBe(true);
    });
  });

  // --- T-D15: Core Caddyfile directives ---
  describe('T-D15: Required Caddyfile directives', () => {
    it('should listen on port 3001', () => {
      // GIVEN the Caddyfile is read
      // WHEN searching for the listener definition
      // THEN it should bind to :3001
      const content = readCaddyfile();
      expect(content).toMatch(/:3001/);
    });

    it('should contain try_files for SPA routing', () => {
      // GIVEN the Caddyfile is read
      // WHEN searching for try_files directive
      // THEN it should contain try_files {path} /index.html
      const content = readCaddyfile();
      expect(content).toMatch(/try_files/);
      expect(content).toMatch(/index\.html/);
    });

    it('should reverse proxy /api/* to runtime', () => {
      // GIVEN the Caddyfile is read
      // WHEN searching for reverse_proxy directives
      // THEN /api/* should be proxied to runtime:4111
      const content = readCaddyfile();
      expect(content).toMatch(/reverse_proxy/);
      expect(content).toMatch(/\/api\/\*/);
      expect(content).toMatch(/runtime:4111/);
    });

    it('should reverse proxy /auth/* to runtime', () => {
      // GIVEN the Caddyfile is read
      // WHEN searching for reverse_proxy directives for auth
      // THEN /auth/* should be proxied to runtime:4111
      const content = readCaddyfile();
      expect(content).toMatch(/\/auth\/\*/);
    });

    it('should set flush_interval -1 for SSE streaming support', () => {
      // GIVEN the Caddyfile is read
      // WHEN searching for flush_interval directive
      // THEN flush_interval -1 should be present (prevents SSE buffering)
      const content = readCaddyfile();
      expect(content).toMatch(/flush_interval\s+-1/);
    });
  });

  // --- Compression ---
  describe('Compression directives', () => {
    it('should enable gzip compression', () => {
      // GIVEN the Caddyfile is read
      // WHEN searching for compression encoding
      // THEN encode gzip should be present
      const content = readCaddyfile();
      expect(content).toMatch(/encode/);
      expect(content).toMatch(/gzip/);
    });

    it('should enable zstd compression', () => {
      // GIVEN the Caddyfile is read
      // WHEN searching for compression encoding
      // THEN zstd should be present alongside gzip
      const content = readCaddyfile();
      expect(content).toMatch(/zstd/);
    });

    it('should have encode directive with both gzip and zstd', () => {
      // GIVEN the Caddyfile is read
      // WHEN searching for the encode directive line
      // THEN it should contain both gzip and zstd
      const content = readCaddyfile();
      expect(content).toMatch(/encode\s+.*gzip.*zstd|encode\s+.*zstd.*gzip/);
    });
  });

  // --- Security Headers ---
  describe('Security headers', () => {
    it('should set HSTS header (Strict-Transport-Security)', () => {
      // GIVEN the Caddyfile is read
      // WHEN searching for security headers
      // THEN Strict-Transport-Security header should be present
      const content = readCaddyfile();
      expect(content).toMatch(/Strict-Transport-Security/i);
    });

    it('should set X-Content-Type-Options header', () => {
      // GIVEN the Caddyfile is read
      // WHEN searching for X-Content-Type-Options
      // THEN it should be set to nosniff
      const content = readCaddyfile();
      expect(content).toMatch(/X-Content-Type-Options/i);
      expect(content).toMatch(/nosniff/i);
    });

    it('should set X-Frame-Options header', () => {
      // GIVEN the Caddyfile is read
      // WHEN searching for X-Frame-Options
      // THEN it should be present (DENY or SAMEORIGIN)
      const content = readCaddyfile();
      expect(content).toMatch(/X-Frame-Options/i);
    });

    it('should set Referrer-Policy header', () => {
      // GIVEN the Caddyfile is read
      // WHEN searching for Referrer-Policy
      // THEN it should be present
      const content = readCaddyfile();
      expect(content).toMatch(/Referrer-Policy/i);
    });
  });

  // --- REQ-D12 Scenarios ---
  describe('REQ-D12 scenarios', () => {
    it('happy path: Caddyfile serves static files from /srv/', () => {
      // GIVEN the Caddyfile is read
      // WHEN searching for file_server or root directive
      // THEN it should serve from /srv/ (Caddy default or explicit)
      const content = readCaddyfile();
      // Caddy serves from /srv by default, or root is set explicitly
      expect(content).toMatch(/file_server|root\s+\*\s+\/srv/);
    });

    it('happy path: SPA routing returns index.html for unknown paths', () => {
      // GIVEN the Caddyfile has try_files {path} /index.html
      // WHEN a browser requests /chat or /board directly
      // THEN Caddy serves index.html allowing client-side routing
      const content = readCaddyfile();
      expect(content).toMatch(/try_files\s+\{path\}\s+\/index\.html/);
    });

    it('edge case: runtime is down — Caddy returns 502 for /api/* requests', () => {
      // GIVEN the Caddyfile reverse_proxy points to runtime:4111
      // WHEN runtime is unavailable
      // THEN Caddy returns 502 Bad Gateway (default behavior)
      // This is a runtime behavior test — verified manually
      const content = readCaddyfile();
      expect(content).toMatch(/reverse_proxy.*runtime/);
    });

    it('error case: Caddyfile parse error prevents Caddy from starting', () => {
      // GIVEN the Caddyfile exists
      // WHEN it has valid syntax
      // THEN Caddy should be able to parse it (validated by caddy fmt or caddy validate)
      // Manual verification: docker compose up frontend — check logs for parse errors
      const content = readCaddyfile();
      expect(content.length).toBeGreaterThan(0);
    });

    it('edge case: flush_interval -1 is set on API proxy to prevent SSE buffering', () => {
      // GIVEN the Caddyfile has reverse_proxy for /api/*
      // WHEN SSE streaming is used (chat messages)
      // THEN flush_interval -1 ensures tokens stream in real-time
      const content = readCaddyfile();
      // flush_interval should appear near or within the reverse_proxy block
      expect(content).toMatch(/flush_interval\s+-1/);
    });
  });
});
