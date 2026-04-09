/**
 * SPEC-20260409-002 — Auth Pages (Login/Register)
 * REQ-FE04: Register Page
 *
 * Tests for the /register route — form rendering, submission, auto-login, error handling.
 * Validates source code structure and correctness via file inspection.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const PROJECT_ROOT = resolve(__dirname, '../../');
const REGISTER_PAGE = resolve(PROJECT_ROOT, 'frontend/src/routes/register.tsx');

function readRegisterPage(): string {
  expect(existsSync(REGISTER_PAGE), 'register.tsx must exist').toBe(true);
  return readFileSync(REGISTER_PAGE, 'utf-8');
}

describe('SPEC-20260409-002: Auth Pages — Register Page', () => {

  // ─── REQ-FE04: Register Page ────────────────────────────────────

  describe('REQ-FE04: Register Page', () => {

    // Acceptance Criteria
    it('should display centered card with name, email, and password inputs on navy background', () => {
      // GIVEN an unauthenticated user navigates to /register
      // WHEN the page loads
      // THEN a centered card with name, email, and password inputs is displayed on a navy background
      const src = readRegisterPage();

      // Navy background on container
      expect(src).toContain('bg-navy');

      // Centered layout
      expect(src).toMatch(/items-center/);
      expect(src).toMatch(/justify-center/);

      // Card element
      expect(src).toContain('bg-card');

      // Three inputs: name, email, password
      expect(src).toMatch(/type="text"/);
      expect(src).toMatch(/type="email"/);
      expect(src).toMatch(/type="password"/);

      // Input IDs
      expect(src).toMatch(/id="name"/);
      expect(src).toMatch(/id="email"/);
      expect(src).toMatch(/id="password"/);
    });

    it('should create account, auto-login, and redirect to /chat on valid submission', () => {
      // GIVEN the register form
      // WHEN the user submits valid data
      // THEN an account is created and the user is automatically logged in and redirected to /chat
      const src = readRegisterPage();

      // Calls signUp.email
      expect(src).toMatch(/authClient\.signUp\.email/);

      // Passes name, email, password
      expect(src).toMatch(/signUp\.email\(\s*\{/);
      expect(src).toContain('name');
      expect(src).toContain('email');
      expect(src).toContain('password');

      // Navigates to /chat on success
      expect(src).toMatch(/navigate\(\s*\{\s*to:\s*["']\/chat["']/);
    });

    it('should display inline error when email is already registered', () => {
      // GIVEN the register form
      // WHEN the email is already registered
      // THEN an error message is displayed inline
      const src = readRegisterPage();

      // Handles duplicate email error
      expect(src).toMatch(/already/i);
      expect(src).toMatch(/error/i);

      // Error is shown inline (role="alert" or error state rendered)
      expect(src).toMatch(/role="alert"|error.*&&/i);
    });

    it('should match neumorphic styling of the login page', () => {
      // GIVEN the register page
      // WHEN rendered
      // THEN it matches the neumorphic styling of the login page
      const src = readRegisterPage();

      // shadow-neu-raised on card
      expect(src).toContain('shadow-neu-raised');

      // shadow-neu-inset on inputs
      expect(src).toContain('shadow-neu-inset');

      // bg-orange on CTA button
      expect(src).toContain('bg-orange');
    });

    // Scenarios — Happy path
    it('should complete register flow: fill name/email/password → click Create Account → redirect to /chat', () => {
      // Happy path: User fills name/email/password → clicks "Create Account" → account created → redirected to /chat
      const src = readRegisterPage();

      // Form has onSubmit handler
      expect(src).toMatch(/onSubmit=\{handleSubmit\}/);

      // signUp.email called with { name, email, password }
      expect(src).toMatch(/authClient\.signUp\.email\(\s*\{/);

      // Navigates to /chat
      expect(src).toMatch(/navigate\(\s*\{\s*to:\s*["']\/chat["']/);

      // Uses state for form fields
      expect(src).toMatch(/useState.*""/);
    });

    // Scenarios — Edge case
    it('should redirect already authenticated user from /register to /chat', () => {
      // Edge case: User is already authenticated → visiting /register redirects to /chat
      const src = readRegisterPage();

      // Checks isAuthenticated
      expect(src).toMatch(/isAuthenticated/);

      // Redirects to /chat
      expect(src).toMatch(/if\s*\(\s*isAuthenticated\s*\)/);
      expect(src).toMatch(/navigate\(\s*\{\s*to:\s*["']\/chat["']/);
    });

    // Scenarios — Error cases
    it('should show "An account with this email already exists" on duplicate email', () => {
      // Error case: Duplicate email → inline error "An account with this email already exists"
      const src = readRegisterPage();

      expect(src).toContain('An account with this email already exists');
    });

    it('should show inline error on weak password if backend enforces', () => {
      // Error case: Weak password (if backend enforces) → inline error with backend message
      const src = readRegisterPage();

      // Handles password-related errors from backend
      expect(src).toMatch(/password/i);

      // Uses result.error.message for display
      expect(src).toMatch(/result\.error\.message/);

      // Error state displayed inline
      expect(src).toMatch(/\{error\s*&&/);
    });

    it('should show connection error when backend is unreachable', () => {
      // Error case: Backend unreachable → error message "Unable to connect. Please try again."
      const src = readRegisterPage();

      expect(src).toContain('Unable to connect. Please try again.');

      // Uses try/catch for network errors
      expect(src).toMatch(/catch\s*\(/);
    });

    // UX Design elements
    it('should render "Create Account" CTA button with orange background', () => {
      // Verify: submit button text is "Create Account", has bg-orange class
      const src = readRegisterPage();

      expect(src).toContain('Create Account');
      expect(src).toContain('bg-orange');

      // Button is type="submit"
      expect(src).toMatch(/type="submit"/);
    });

    it('should render footer link to /login', () => {
      // Verify: link with text containing "Log in" points to /login
      const src = readRegisterPage();

      expect(src).toContain('Log in');
      expect(src).toMatch(/to="\/login"/);
      expect(src).toContain('Already have an account?');
    });

    it('should render name input above email input', () => {
      // Verify: name input appears before email input in DOM order
      const src = readRegisterPage();

      const namePos = src.indexOf('id="name"');
      const emailPos = src.indexOf('id="email"');

      expect(namePos).toBeGreaterThan(-1);
      expect(emailPos).toBeGreaterThan(-1);
      expect(namePos).toBeLessThan(emailPos);
    });
  });
});
