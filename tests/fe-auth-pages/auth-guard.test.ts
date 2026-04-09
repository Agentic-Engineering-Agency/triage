/**
 * SPEC-20260409-002 — Auth Pages (Login/Register)
 * REQ-FE05: Auth Guard (Protected Routes)
 *
 * Tests for root route auth enforcement — redirect logic, loading state, auth bypass for login/register.
 * Validates source code structure and correctness via file inspection.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const PROJECT_ROOT = resolve(__dirname, '../../');
const ROOT_LAYOUT = resolve(PROJECT_ROOT, 'frontend/src/routes/__root.tsx');

function readRootLayout(): string {
  expect(existsSync(ROOT_LAYOUT), '__root.tsx must exist').toBe(true);
  return readFileSync(ROOT_LAYOUT, 'utf-8');
}

describe('SPEC-20260409-002: Auth Pages — Auth Guard', () => {

  // ─── REQ-FE05: Auth Guard (Protected Routes) ───────────────────

  describe('REQ-FE05: Auth Guard (Protected Routes)', () => {

    // Acceptance Criteria
    it('should redirect unauthenticated user to /login for any route except /login or /register', () => {
      // GIVEN an unauthenticated user
      // WHEN they navigate to any route except /login or /register
      // THEN they are redirected to /login
      const src = readRootLayout();

      // Checks !isAuthenticated && !isAuthPage
      expect(src).toMatch(/!isAuthenticated\s*&&\s*!isAuthPage/);

      // Redirects to /login
      expect(src).toMatch(/Navigate\s+to="\/login"/);
    });

    it('should redirect authenticated user from /login or /register to /chat', () => {
      // GIVEN an authenticated user
      // WHEN they navigate to /login or /register
      // THEN they are redirected to /chat
      const src = readRootLayout();

      // Checks isAuthenticated && isAuthPage
      expect(src).toMatch(/isAuthenticated\s*&&\s*isAuthPage/);

      // Redirects to /chat
      expect(src).toMatch(/Navigate\s+to="\/chat"/);
    });

    it('should show loading spinner while auth state is loading', () => {
      // GIVEN the auth state is loading
      // WHEN any page renders
      // THEN a loading spinner is shown (not a flash of login page)
      const src = readRootLayout();

      // Checks isLoading
      expect(src).toMatch(/if\s*\(\s*isLoading\s*\)/);

      // Shows spinner with animate-spin
      expect(src).toContain('animate-spin');

      // Loading check comes before auth redirect (spinner shown before redirect logic)
      const loadingPos = src.indexOf('isLoading');
      const redirectPos = src.indexOf('!isAuthenticated && !isAuthPage');
      expect(loadingPos).toBeGreaterThan(-1);
      expect(redirectPos).toBeGreaterThan(-1);
      expect(loadingPos).toBeLessThan(redirectPos);
    });

    // Scenarios — Happy path
    it('should allow authenticated user to navigate freely between /chat, /board, /settings', () => {
      // Happy path: Authenticated user navigates freely between /chat, /board, /settings
      // When isAuthenticated is true and isAuthPage is false, no redirect occurs — Outlet renders
      const src = readRootLayout();

      // The layout renders Outlet for authenticated non-auth pages (sidebar + Outlet)
      expect(src).toContain('<Outlet />');

      // Sidebar has navigation links to /chat, /board, /settings
      expect(src).toMatch(/to="\/chat"/);
      expect(src).toMatch(/to="\/board"/);
      expect(src).toMatch(/to="\/settings"/);

      // No blanket redirect for authenticated users on normal pages
      // The redirect to /login only fires when !isAuthenticated && !isAuthPage
      expect(src).toMatch(/!isAuthenticated\s*&&\s*!isAuthPage/);
    });

    // Scenarios — Edge cases
    it('should redirect direct URL access to /chat when unauthenticated', () => {
      // Edge case: Direct URL access to /chat while unauthenticated → redirect to /login
      const src = readRootLayout();

      // isAuthPage only matches /login and /register, so /chat is not an auth page
      expect(src).toMatch(/pathname\s*===\s*"\/login"/);
      expect(src).toMatch(/pathname\s*===\s*"\/register"/);

      // For unauthenticated users on non-auth pages, redirect to /login
      expect(src).toMatch(/!isAuthenticated\s*&&\s*!isAuthPage/);
      expect(src).toMatch(/Navigate\s+to="\/login"/);
    });

    it('should show spinner then content on browser refresh while authenticated', () => {
      // Edge case: Browser refresh while authenticated → loading spinner → content (no flash)
      const src = readRootLayout();

      // isLoading guard comes first, before any redirect
      const loadingCheck = src.indexOf('isLoading');
      const unauthRedirect = src.indexOf('!isAuthenticated && !isAuthPage');
      const authRedirect = src.indexOf('isAuthenticated && isAuthPage');

      expect(loadingCheck).toBeGreaterThan(-1);
      expect(unauthRedirect).toBeGreaterThan(-1);
      expect(authRedirect).toBeGreaterThan(-1);

      // Loading check is evaluated before both redirect checks
      expect(loadingCheck).toBeLessThan(unauthRedirect);
      expect(loadingCheck).toBeLessThan(authRedirect);

      // Spinner is rendered during loading
      expect(src).toContain('animate-spin');
    });

    // Scenarios — Error case
    it('should redirect to /login when session check fails due to network error', () => {
      // Error case: Session check fails (network) → redirect to /login as fallback
      // When session fails, isAuthenticated is false and isLoading is false → redirect to /login
      const src = readRootLayout();

      // Uses useAuth() which derives isAuthenticated from session data
      expect(src).toMatch(/useAuth\(\)/);

      // Destructures isAuthenticated, isLoading
      expect(src).toMatch(/isAuthenticated/);
      expect(src).toMatch(/isLoading/);

      // When session fails: isAuthenticated=false, isLoading=false → !isAuthenticated && !isAuthPage → redirect
      expect(src).toMatch(/!isAuthenticated\s*&&\s*!isAuthPage/);
      expect(src).toMatch(/Navigate\s+to="\/login"/);
    });

    // Implementation specifics
    it('should render auth pages without sidebar', () => {
      // Verify: /login and /register render Outlet directly without sidebar wrapper
      const src = readRootLayout();

      // isAuthPage check returns just Outlet (no sidebar)
      expect(src).toMatch(/if\s*\(\s*isAuthPage\s*\)/);

      // The auth page branch returns <Outlet /> directly
      // Find the isAuthPage-only block (not "!isAuthPage")
      const authPageBlock = src.indexOf('if (isAuthPage)');
      expect(authPageBlock).toBeGreaterThan(-1);

      // After the isAuthPage check, Outlet is returned without the sidebar <aside> wrapper
      const afterAuthPageCheck = src.slice(authPageBlock, authPageBlock + 100);
      expect(afterAuthPageCheck).toContain('Outlet');

      // Sidebar is in the main layout but not in the auth page branch
      expect(src).toContain('<aside');
    });

    it('should display real user name in sidebar when authenticated', () => {
      // Verify: sidebar shows user.name from useAuth() instead of hardcoded "Koki"
      const src = readRootLayout();

      // Uses user?.name for display (dynamic, not hardcoded)
      expect(src).toMatch(/user\?\.name/);

      // Uses user?.email for display
      expect(src).toMatch(/user\?\.email/);

      // Does NOT contain hardcoded "Koki"
      expect(src).not.toContain('"Koki"');
      expect(src).not.toContain("'Koki'");

      // User data comes from useAuth()
      expect(src).toMatch(/useAuth\(\)/);
    });
  });
});
