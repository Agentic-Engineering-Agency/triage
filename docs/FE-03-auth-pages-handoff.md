# FE-03 — Auth Pages (Login/Register) — Implementation Handoff

**Branch:** `feature/fe-auth-pages`
**Spec:** SPEC-20260409-002
**Ticket:** FE-03 — Auth Pages (Login/Register)
**Epic:** Frontend | **Tier:** 1 (Must Ship) | **Estimate:** 2h
**Date:** 2026-04-09

---

## Ticket Acceptance Criteria — Status

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | User can register with email/password | ✅ Done | `/register` page → `signUp.email()` → auto-login → redirect |
| 2 | User can login and be redirected to chat | ✅ Done | `/login` page → `signIn.email()` → redirect to `/chat` |
| 3 | Unauthenticated access redirects to login | ✅ Done | Auth guard in `__root.tsx` — all routes protected |

## Ticket Requirements — Status

| Requirement | Status | Details |
|------------|--------|---------|
| Email/password form | ✅ Done | Both login and register pages with validated forms |
| Better Auth client SDK integration | ✅ Done | `auth-client.ts` with `createAuthClient`, basePath `/auth` |
| Redirect to chat after login | ✅ Done | `navigate({ to: "/chat" })` on success |
| Protected routes | ✅ Done | Root layout auth guard with `<Navigate to="/login" />` |
| Clean, minimal design with shadcn/ui | ✅ Done | Neumorphic cards, navy bg, orange CTA, Space Grotesk headings |
| Dependency: INFRA-02 (Better Auth backend) | ✅ Met | Backend auth at `/auth/*` operational with LibSQL persistence |

## What Was Built

### Frontend (6 files)

| File | What It Does |
|------|-------------|
| `frontend/src/lib/auth-client.ts` | Better Auth client SDK singleton. baseURL from `window.location.origin`, basePath `/auth`. Exports `signIn`, `signUp`, `signOut`. |
| `frontend/src/hooks/use-auth.ts` | `useAuth()` hook wrapping Better Auth's `useSession()`. Returns `{ user, isLoading, isAuthenticated }`. Re-exports `signIn`, `signUp`, `signOut`. |
| `frontend/src/routes/login.tsx` | Login page at `/login`. Email+password form, error handling (API errors, network errors, fallback messages), loading state, redirect if authenticated. |
| `frontend/src/routes/register.tsx` | Register page at `/register`. Name+email+password form, duplicate email detection, password error passthrough, loading state, redirect if authenticated. |
| `frontend/src/routes/__root.tsx` | Root layout with auth guard. Loading spinner → unauthenticated redirect → auth page bypass → authenticated layout with sidebar (nav links, user info, theme toggle, logout button). |
| `frontend/vite.config.ts` | Dev proxy: `/auth` → backend:4111, `/chat` POST-only → backend:4111 (GET serves SPA). |

### Backend (1 file modified)

| File | Change |
|------|--------|
| `runtime/src/auth/index.ts` | Added `localhost:3002` to dev trusted origins for SSH port-forwarded testing. |

### Infrastructure (1 file modified)

| File | Change |
|------|--------|
| `docker-compose.override.yml` | Fixed `mastra dev --port 4111` → `PORT=4111` env var (mastra CLI dropped `--port` flag). |

### Tests (E2E with Playwright)

| File | Tests | What It Covers |
|------|-------|----------------|
| `tests/fe-auth-pages/auth-e2e.e2e.ts` | 33 | Full E2E against running stack: health checks, auth guard redirects, login/register rendering, real sign-up/sign-in flows, error handling, sidebar verification, authenticated redirects, proxy integration, page navigation |
| `playwright.config.ts` | — | Playwright config: chromium headless, baseURL localhost:3001 |

**All 33 E2E tests pass against the real stack (Vite + Mastra + Better Auth + LibSQL). Zero mocks.**

## Auth Flow

```
Unauthenticated user → any route → auth guard → redirect /login
                                                       ↓
                              /login ← fill form → signIn.email()
                                                       ↓
                                              success → redirect /chat → sidebar with user info
                                              error   → show alert (invalid creds / network error)

New user → /register → fill form → signUp.email()
                                       ↓
                              success → auto-login → redirect /chat
                              error   → "already exists" / password error / network error

Authenticated user → /login or /register → redirect to /chat
Authenticated user → click logout → signOut() → redirect /login
```

## How to Run

```bash
# Start the stack
cd runtime && PORT=4111 npx mastra dev &
cd frontend && npx vite --port 3001 --host &

# Run E2E tests
npm run test:e2e:auth

# Or run all E2E tests
npm run test:e2e
```

Requires LibSQL running on `:8080` (via docker-compose or direct).

## Commits on This Branch

| Hash | Message |
|------|---------|
| `5218fc1` | feat(auth): auth client SDK, useAuth hook, vite proxy |
| `2ba6bee` | feat(auth): register page + auth guard activation |
| `f9facf0` | feat(auth): login page with neumorphic UX |
| `0bc2e3a` | test(auth): auth guard tests |
| `8d58853` | qa(auth): QA report GO — 53/53 tests, 6/6 REQs |
| `eda6eca` | test(auth): rewrite tests as E2E with Playwright — 33/33 |
| `621dc7c` | fix(auth): logout button, /chat proxy bypass, dev trusted origin |

## Known Limitations

- No password confirmation field on register (acceptable for hackathon)
- No forgot password flow (out of scope per spec)
- No OAuth/social login (out of scope per spec)
- Spec says `max-w-sm` for cards, implementation uses `max-w-md` (cosmetic)
