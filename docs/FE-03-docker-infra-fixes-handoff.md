# FE-03 — Docker Infrastructure Fixes — Handoff

**Branch:** `feature/fe-auth-pages`
**Date:** 2026-04-09
**Context:** After merging dev (`5ac0512`), the Docker environment was broken — runtime crashed on startup, frontend served stale builds, auth tables didn't exist. These fixes make `docker compose up --build` work out of the box.

---

## Summary of Issues & Fixes

### 1. Runtime crash: LibSQL ECONNREFUSED (localhost:8080)

**Root cause:** `mastra dev` uses dotenv to load `runtime/.env`, which contains `LIBSQL_URL=http://localhost:8080` (for local dev without Docker). This overrode the Docker-injected env var `http://libsql:8080`.

**Fix (docker-compose.override.yml):** `sed` rewrites `LIBSQL_URL` in the baked-in `.env` before `mastra dev` starts. Also sets `LIBSQL_URL=http://libsql:8080` explicitly in the environment block.

### 2. Database tables missing: "no such table: auth_user"

**Root cause:** Fresh LibSQL container has no tables. `drizzle-kit push` requires interactive TTY (unsuitable for Docker).

**Fix:** Created `runtime/init-db.mjs` — runs `CREATE TABLE IF NOT EXISTS` for all 7 tables (auth_user, auth_session, auth_account, auth_verification, wiki_documents, wiki_chunks, local_tickets). Executes before the server starts in both dev and production Docker.

### 3. Vite container crash: ERR_MODULE_NOT_FOUND

**Root cause:** Anonymous volume `/app/node_modules` was empty with no `npm install` step.

**Fix (docker-compose.override.yml):** Changed Vite command to `sh -c "npm install && npx vite --host 0.0.0.0"` and switched to a named volume `vite_node_modules`.

### 4. CSP blocks Vite inline scripts in dev mode

**Root cause:** Caddy's `Content-Security-Policy` header had `script-src 'self'`, blocking Vite's HMR preamble injection (`@vitejs/plugin-react can't detect preamble`).

**Fix (Caddyfile):** Dev-frontend snippet overrides CSP to allow `'unsafe-inline'` and `'unsafe-eval'` for scripts, plus `ws://` for Vite HMR WebSocket.

### 5. Duplicate import in mastra/index.ts

**Root cause:** Merge conflict left duplicate `import { registerApiRoute }` on lines 2 and 5, causing `mastra build` to fail.

**Fix:** Removed the duplicate import line.

### 6. Auth 403 "invalid origin" via SSH tunnel

**Root cause:** Better Auth `trustedOrigins` only included `localhost:3001`. SSH port-forward testing uses `localhost:3002`. Also, `NODE_ENV=production` was set by Dockerfile even in dev override (via `target: builder` inheriting base image state).

**Fix:** Added `http://localhost:3002` to dev trustedOrigins in `runtime/src/lib/auth.ts`. Added `NODE_ENV=development` to docker-compose.override.yml environment.

---

## Files Changed

| File | Change |
|------|--------|
| `runtime/init-db.mjs` | **New.** Creates all 7 DB tables idempotently on startup. |
| `Dockerfile.runtime` | Copies `init-db.mjs` into production image. CMD runs `node init-db.mjs && node index.mjs`. |
| `docker-compose.override.yml` | Vite: `npm install` + named volume. Runtime: `sed` fix for .env, `LIBSQL_URL` + `NODE_ENV=development` env vars, init-db mount. Frontend: `FRONTEND_MODE: static`. |
| `Caddyfile` | Dev-frontend snippet: relaxed CSP for Vite HMR (unsafe-inline, unsafe-eval, ws://). |
| `runtime/src/lib/auth.ts` | Added `localhost:3002` to dev trustedOrigins for SSH tunnel testing. |
| `runtime/src/mastra/index.ts` | Removed duplicate `registerApiRoute` import (merge artifact). |

## Architecture Notes

### Dev mode (docker-compose.override.yml auto-loaded)

```
Browser → Caddy:3001 (static files from /srv/) → runtime:4111 (/api/*, /auth/*)
                                                 ↕
                                           LibSQL:8080

Runtime runs: sed .env → init-db.mjs → mastra dev (hot reload)
```

### Production mode (`docker compose -f docker-compose.yml up --build`)

```
Browser → Caddy:3001 (static files from /srv/) → runtime:4111 (/api/*, /auth/*)
                                                 ↕
                                           LibSQL:8080

Runtime runs: node init-db.mjs && node index.mjs
```

### SSH tunnel testing

```
Local browser:3002 → SSH tunnel → Server:3001 → Caddy → runtime:4111
```

Requires `http://localhost:3002` in Better Auth trustedOrigins (dev only).

## How to Run

```bash
# Dev mode (default — auto-loads override)
docker compose up --build

# Production mode (no override, no Vite, no hot reload)
docker compose -f docker-compose.yml up --build

# SSH tunnel from local machine
ssh -L 3002:localhost:3001 agent@<server-ip>
# Then open http://localhost:3002
```

## Verified Auth Flow (E2E in Docker)

1. Navigate to `/` → auth guard redirects to `/login`
2. Click "Register" → fill form → Create Account → redirects to `/chat` with user info in sidebar
3. Click "Sign out" → redirects to `/login`
4. Fill login form → Log In → redirects to `/chat`
5. All tested via Playwright (server-side) and manual SSH tunnel (client-side)
