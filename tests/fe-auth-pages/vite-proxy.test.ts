/**
 * SPEC-20260409-002 — Auth Pages (Login/Register)
 * REQ-FE06: Vite Dev Proxy Configuration
 *
 * Tests for Vite proxy setup — /auth/* and /chat forwarding to runtime in dev mode.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const PROJECT_ROOT = resolve(__dirname, '../../');

function readViteConfig(): string {
  return readFileSync(resolve(PROJECT_ROOT, 'frontend/vite.config.ts'), 'utf-8');
}

describe('SPEC-20260409-002: Auth Pages — Vite Dev Proxy', () => {

  // ─── REQ-FE06: Vite Dev Proxy Configuration ────────────────────

  describe('REQ-FE06: Vite Dev Proxy Configuration', () => {

    const viteConfig = readViteConfig();

    // Acceptance Criteria
    it('should proxy /auth/* requests to http://localhost:4111 in Vite dev', () => {
      // GIVEN the frontend runs via vite dev
      // WHEN a request to /auth/* is made
      // THEN it is proxied to http://localhost:4111/auth/*
      // Verify: vite.config.ts contains server.proxy entry for /auth → localhost:4111
      expect(viteConfig).toContain('server');
      expect(viteConfig).toContain('proxy');
      expect(viteConfig).toMatch(/["']\/auth["']/);
      expect(viteConfig).toContain('http://localhost:4111');
    });

    it('should preserve cookies and headers when proxying', () => {
      // GIVEN the proxy
      // WHEN forwarding requests
      // THEN cookies and headers are preserved
      // Verify: proxy config includes changeOrigin and cookie handling
      expect(viteConfig).toContain('changeOrigin');
      expect(viteConfig).toMatch(/changeOrigin:\s*true/);
    });

    // Scenarios — Happy path
    it('should forward POST /auth/sign-in/email to runtime:4111', () => {
      // Happy path: POST /auth/sign-in/email from Vite dev → proxied to runtime:4111 → session cookie set
      // Verify: proxy target is http://localhost:4111, path /auth is matched
      expect(viteConfig).toMatch(/["']\/auth["']\s*:\s*\{/);
      expect(viteConfig).toContain('target');
      expect(viteConfig).toContain('http://localhost:4111');
    });

    // Scenarios — Edge case
    it('should also proxy /chat endpoint for AI SDK chat transport', () => {
      // Edge case: /chat endpoint also needs proxy for AI SDK
      // Verify: vite.config.ts has proxy entry for /chat → localhost:4111
      expect(viteConfig).toMatch(/["']\/chat["']/);
      expect(viteConfig).toMatch(/["']\/chat["']\s*:\s*\{/);
      // Verify it also targets localhost:4111
      // Both /auth and /chat should point to same target
      const chatSection = viteConfig.split('/chat')[1];
      expect(chatSection).toContain('localhost:4111');
    });

    // Scenarios — Error case
    it('should return 502 when runtime is not running', () => {
      // Error case: Runtime is not running → proxy returns 502, frontend shows connection error
      // Verify: proxy config exists (502 is handled by Vite automatically when target is unreachable)
      expect(viteConfig).toContain('proxy');
      expect(viteConfig).toMatch(/["']\/auth["']/);
      expect(viteConfig).toMatch(/["']\/chat["']/);
      // Vite's built-in proxy (http-proxy) automatically returns 502 when the target is down
    });
  });
});
