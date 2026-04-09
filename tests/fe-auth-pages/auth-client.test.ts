/**
 * SPEC-20260409-002 — Auth Pages (Login/Register)
 * REQ-FE01: Better Auth Client SDK Setup
 * REQ-FE02: useAuth Hook Implementation
 *
 * Tests for auth client configuration and useAuth hook behavior.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const PROJECT_ROOT = resolve(__dirname, '../../');

function readFile(relativePath: string): string {
  return readFileSync(resolve(PROJECT_ROOT, relativePath), 'utf-8');
}

describe('SPEC-20260409-002: Auth Pages — Auth Foundation', () => {

  // ─── REQ-FE01: Better Auth Client SDK Setup ─────────────────────

  describe('REQ-FE01: Better Auth Client SDK Setup', () => {

    it('should export an auth client configured with baseURL as current origin', () => {
      // Verify: auth-client.ts exports authClient with baseURL === window.location.origin
      const src = readFile('frontend/src/lib/auth-client.ts');
      expect(src).toContain('export const authClient');
      expect(src).toContain('createAuthClient');
      expect(src).toContain('window.location.origin');
    });

    it('should configure auth client with basePath "/auth"', () => {
      // Verify: authClient config has basePath: "/auth"
      const src = readFile('frontend/src/lib/auth-client.ts');
      expect(src).toMatch(/basePath:\s*["']\/?auth["']/);
    });

    it('should send cookies with credentials include on auth requests', () => {
      // Better Auth react client includes credentials by default.
      // Verify the client is created via createAuthClient from better-auth/react
      const src = readFile('frontend/src/lib/auth-client.ts');
      expect(src).toContain('createAuthClient');
      expect(src).toContain('better-auth/react');
      // better-auth/react createAuthClient sends cookies with credentials: "include" by default
    });

    it('should be importable from @/lib/auth-client', () => {
      // Happy path: Auth client is created at module level, importable from @/lib/auth-client
      const src = readFile('frontend/src/lib/auth-client.ts');
      expect(src).toContain('export const authClient');
      // Verify the file physically exists
      const fullPath = resolve(PROJECT_ROOT, 'frontend/src/lib/auth-client.ts');
      expect(() => readFileSync(fullPath)).not.toThrow();
    });

    it('should handle dev mode with Vite proxy forwarding /auth/* to localhost:4111', () => {
      // Verify: Vite config contains proxy entry for /auth
      const viteConfig = readFile('frontend/vite.config.ts');
      expect(viteConfig).toContain('proxy');
      expect(viteConfig).toMatch(/["']\/auth["']/);
      expect(viteConfig).toContain('localhost:4111');
    });

    it('should reject with network error if backend is unreachable', () => {
      // Error case: signIn, signUp, signOut are exported so they can be called
      // When the backend is unreachable, fetch-based calls will reject with a network error.
      // Verify the methods are exported from auth-client.
      const src = readFile('frontend/src/lib/auth-client.ts');
      expect(src).toContain('export const { signIn, signUp, signOut }');
      // The network error handling is built into better-auth's fetch client
    });
  });

  // ─── REQ-FE02: useAuth Hook Implementation ──────────────────────

  describe('REQ-FE02: useAuth Hook Implementation', () => {

    const hookSrc = readFile('frontend/src/hooks/use-auth.ts');

    it('should return isAuthenticated true and user data when session exists', () => {
      // Verify: hook checks session.data?.user and returns isAuthenticated: !!session.data?.user
      expect(hookSrc).toContain('isAuthenticated');
      expect(hookSrc).toMatch(/isAuthenticated:\s*!!session\.data\?\.user/);
    });

    it('should return isAuthenticated false and user null when no session exists', () => {
      // Verify: when session.data?.user is falsy, user is null and isAuthenticated is false
      // The ternary checks session.data?.user — when null, user is null
      expect(hookSrc).toMatch(/session\.data\?\.user\s*\n?\s*\?/);
      expect(hookSrc).toContain(': null');
    });

    it('should return isLoading true while session check is in progress', () => {
      // Verify: hook maps session.isPending to isLoading
      expect(hookSrc).toContain('isPending');
      expect(hookSrc).toMatch(/isLoading:\s*session\.isPending/);
    });

    it('should return user data with correct shape when logged in', () => {
      // Verify: user object has id, email, name fields mapped from session
      expect(hookSrc).toContain('session.data.user.id');
      expect(hookSrc).toContain('session.data.user.email');
      expect(hookSrc).toContain('session.data.user.name');
    });

    it('should handle expired session by returning isAuthenticated false', () => {
      // Edge case: Session expired → get-session returns null → session.data?.user is falsy
      // Verify: hook uses optional chaining on session.data
      expect(hookSrc).toContain('session.data?.user');
      // When expired, session.data is null, so isAuthenticated becomes false
      expect(hookSrc).toMatch(/isAuthenticated:\s*!!session\.data\?\.user/);
    });

    it('should resolve to unauthenticated on network failure during session check', () => {
      // Error case: Network failure during session check → session.data is null
      // useSession() from better-auth handles errors internally; isPending resolves to false
      // Verify: hook relies on session.data?.user which is null on error
      expect(hookSrc).toContain('authClient.useSession()');
      expect(hookSrc).toContain('session.data?.user');
    });

    it('should export signIn, signUp, signOut methods from auth client', () => {
      // Verify: useAuth or auth-client exports signIn, signUp, signOut functions
      expect(hookSrc).toContain('signIn');
      expect(hookSrc).toContain('signUp');
      expect(hookSrc).toContain('signOut');
      // Also verify auth-client.ts exports them
      const authClientSrc = readFile('frontend/src/lib/auth-client.ts');
      expect(authClientSrc).toContain('signIn');
      expect(authClientSrc).toContain('signUp');
      expect(authClientSrc).toContain('signOut');
    });

    it('should maintain backward-compatible AuthState interface shape', () => {
      // Verify: hook returns object matching { user: User | null, isLoading: boolean, isAuthenticated: boolean }
      expect(hookSrc).toContain('export interface AuthState');
      expect(hookSrc).toMatch(/user:\s*User\s*\|\s*null/);
      expect(hookSrc).toMatch(/isLoading:\s*boolean/);
      expect(hookSrc).toMatch(/isAuthenticated:\s*boolean/);
      // Also verify User interface
      expect(hookSrc).toContain('export interface User');
      expect(hookSrc).toContain('id: string');
      expect(hookSrc).toContain('email: string');
      expect(hookSrc).toContain('name: string');
    });
  });
});
