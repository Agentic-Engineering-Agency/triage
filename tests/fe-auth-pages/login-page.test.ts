/**
 * SPEC-20260409-002 — Auth Pages (Login/Register)
 * REQ-FE03: Login Page
 *
 * Tests for the /login route — form rendering, submission, error handling, and UX styling.
 * Validates source code structure and correctness via file inspection.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const PROJECT_ROOT = resolve(__dirname, '../../');
const LOGIN_PAGE = resolve(PROJECT_ROOT, 'frontend/src/routes/login.tsx');

function readLoginPage(): string {
  expect(existsSync(LOGIN_PAGE), 'login.tsx must exist').toBe(true);
  return readFileSync(LOGIN_PAGE, 'utf-8');
}

describe('SPEC-20260409-002: Auth Pages — Login Page', () => {

  // ─── REQ-FE03: Login Page ───────────────────────────────────────

  describe('REQ-FE03: Login Page', () => {

    // Acceptance Criteria
    it('should display centered card with email and password inputs on navy background', () => {
      // GIVEN an unauthenticated user navigates to /login
      // WHEN the page loads
      // THEN a centered card with email and password inputs is displayed on a navy background
      const src = readLoginPage();

      // Navy background on container
      expect(src).toContain('bg-navy');

      // Centered layout
      expect(src).toMatch(/items-center/);
      expect(src).toMatch(/justify-center/);

      // Card element
      expect(src).toContain('bg-card');

      // Two inputs: email, password (no name/text input)
      expect(src).toMatch(/type="email"/);
      expect(src).toMatch(/type="password"/);

      // Input IDs
      expect(src).toMatch(/id="email"/);
      expect(src).toMatch(/id="password"/);
    });

    it('should redirect to /chat on successful login', () => {
      // GIVEN the login form
      // WHEN the user submits valid credentials
      // THEN the user is redirected to /chat
      const src = readLoginPage();

      // Calls signIn.email
      expect(src).toMatch(/authClient\.signIn\.email/);

      // Passes email, password
      expect(src).toMatch(/signIn\.email\(\s*\{/);
      expect(src).toContain('email');
      expect(src).toContain('password');

      // Navigates to /chat on success
      expect(src).toMatch(/navigate\(\s*\{\s*to:\s*["']\/chat["']/);
    });

    it('should display inline error on invalid credentials without page reload', () => {
      // GIVEN the login form
      // WHEN the user submits invalid credentials
      // THEN an error message is displayed inline without page reload
      const src = readLoginPage();

      // Handles error from result
      expect(src).toMatch(/result\.error/);
      expect(src).toMatch(/setError/);

      // Error is shown inline (role="alert" or error state rendered)
      expect(src).toMatch(/role="alert"|error.*&&/i);
    });

    it('should use neumorphic design system styling', () => {
      // GIVEN the login page
      // WHEN rendered
      // THEN it uses shadow-neu-raised card, shadow-neu-inset inputs, orange CTA button
      const src = readLoginPage();

      // shadow-neu-raised on card
      expect(src).toContain('shadow-neu-raised');

      // shadow-neu-inset on inputs
      expect(src).toContain('shadow-neu-inset');

      // bg-orange on CTA button
      expect(src).toContain('bg-orange');
    });

    // Scenarios — Happy path
    it('should complete login flow: enter email/password → click Log In → redirect to /chat', () => {
      // Happy path: User enters valid email/password → clicks "Log In" → redirected to /chat
      const src = readLoginPage();

      // Form has onSubmit handler
      expect(src).toMatch(/onSubmit=\{handleSubmit\}/);

      // signIn.email called with { email, password }
      expect(src).toMatch(/authClient\.signIn\.email\(\s*\{/);

      // Navigates to /chat
      expect(src).toMatch(/navigate\(\s*\{\s*to:\s*["']\/chat["']/);

      // Uses state for form fields
      expect(src).toMatch(/useState.*""/);
    });

    // Scenarios — Edge case
    it('should redirect already authenticated user from /login to /chat', () => {
      // Edge case: User is already authenticated → visiting /login redirects to /chat
      const src = readLoginPage();

      // Checks isAuthenticated
      expect(src).toMatch(/isAuthenticated/);

      // Redirects to /chat
      expect(src).toMatch(/if\s*\(\s*isAuthenticated\s*\)/);
      expect(src).toMatch(/navigate\(\s*\{\s*to:\s*["']\/chat["']/);
    });

    // Scenarios — Error cases
    it('should show "Invalid email or password" on wrong credentials', () => {
      // Error case: Wrong password → inline error "Invalid email or password", form not cleared
      const src = readLoginPage();

      expect(src).toContain('Invalid email or password');
    });

    it('should prevent submission with empty fields via HTML5 validation', () => {
      // Error case: Empty fields → HTML5 validation prevents submission (required attributes)
      const src = readLoginPage();

      // Both email and password inputs have required attribute
      const emailIdx = src.indexOf('id="email"');
      const passwordIdx = src.indexOf('id="password"');
      const emailBlock = src.slice(emailIdx - 50, emailIdx + 200);
      const passwordBlock = src.slice(passwordIdx - 50, passwordIdx + 200);

      expect(emailBlock).toContain('required');
      expect(passwordBlock).toContain('required');
    });

    it('should show connection error when backend is unreachable', () => {
      // Error case: Backend unreachable → error message "Unable to connect. Please try again."
      const src = readLoginPage();

      expect(src).toContain('Unable to connect. Please try again.');

      // Uses try/catch for network errors
      expect(src).toMatch(/catch\s*\(/);
    });

    // UX Design elements
    it('should render "Triage" heading in Space Grotesk font', () => {
      // Verify: heading element has font-heading class, text content is "Triage"
      const src = readLoginPage();

      expect(src).toContain('font-heading');
      expect(src).toContain('Triage');
    });

    it('should render subheading tagline in Inter font', () => {
      // Verify: subheading has font-sans class (Inter)
      const src = readLoginPage();

      expect(src).toContain('font-sans');
      expect(src).toContain('SRE Intelligence Platform');
    });

    it('should render "Log In" CTA button with orange background', () => {
      // Verify: submit button text is "Log In", has bg-orange class
      const src = readLoginPage();

      expect(src).toContain('Log In');
      expect(src).toContain('bg-orange');

      // Button is type="submit"
      expect(src).toMatch(/type="submit"/);
    });

    it('should render footer link to /register', () => {
      // Verify: link with text containing "Register" points to /register
      const src = readLoginPage();

      expect(src).toContain('Register');
      expect(src).toMatch(/to="\/register"/);
      expect(src).toContain("Don't have an account?");
    });
  });
});
