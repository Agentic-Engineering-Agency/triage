# PENDING INTEGRATION TESTS — Requires Running Docker Stack

> **DO NOT SHIP TO PRODUCTION WITHOUT COMPLETING THESE.**
> These tests are marked `it.todo(...)` because they require a live Docker
> environment (docker compose up) to validate. They CANNOT be tested via
> static file analysis alone. Implement them once the full stack runs.

## Status: 19 tests pending across 4 files

---

## Priority 1 — Full Stack Smoke Tests (docker-compose.test.ts)

These block "it works from clean clone" confidence:

| # | Test | What to validate |
|---|------|-----------------|
| 1 | all 9 containers should start and become healthy within 120s | `docker compose up --build`, then `docker compose ps` — all healthy |
| 2 | docker compose config should validate without errors | `docker compose config` exits 0, produces valid merged YAML |
| 3 | error case: missing .env variable causes clear startup error | Remove a required var, verify compose fails with clear message |

## Priority 2 — Network Isolation (architecture-alignment.test.ts)

These validate the dual-network architecture actually works:

| # | Test | What to validate |
|---|------|-----------------|
| 4 | network isolation — app-only service cannot resolve langfuse-only hostname | `docker exec frontend nslookup clickhouse` should FAIL |
| 5 | runtime resolves both libsql and langfuse-web hostnames | `docker exec runtime nslookup libsql` AND `nslookup langfuse-web` both succeed |
| 6 | Caddy proxies to runtime:4111 successfully | `curl http://localhost:3001/api/health` returns 200 |

## Priority 3 — Dev/Prod Mode Switching (architecture-alignment.test.ts)

| # | Test | What to validate |
|---|------|-----------------|
| 7 | docker compose up auto-loads override and starts vite with HMR | `docker compose up` → vite container running on :5173 |
| 8 | docker compose -f docker-compose.yml up skips override | Explicit base-only → no vite container |
| 9 | Caddy starts in prod mode when FRONTEND_MODE is unset | Static files served from /srv |
| 10 | Caddy proxies to vite:5173 when FRONTEND_MODE=dev | Frontend requests reach Vite |

## Priority 4 — Config & Service Integration (architecture-alignment.test.ts)

| # | Test | What to validate |
|---|------|-----------------|
| 11 | GET /config.json returns JSON in prod mode | `curl http://localhost:3001/config.json` returns valid JSON, NOT index.html |
| 12 | in dev mode, Vite serves /config.json from public directory | Same endpoint works via Vite proxy |
| 13 | ClickHouse starts with password, Langfuse connects | Check langfuse-web logs for successful ClickHouse connection |
| 14 | MinIO starts, healthcheck passes, dependents can connect | Check langfuse-worker logs for successful S3 operations |
| 15 | redis healthcheck runs without auth warning in logs | `docker compose logs redis` has no "Warning: Using a password" |

## Priority 5 — Graceful Degradation (env-config.test.ts)

| # | Test | What to validate |
|---|------|-----------------|
| 16 | all API keys configured uses real integrations | Full flow with real keys |
| 17 | demo environment has no Linear workspace | LINEAR_API_KEY empty → local tickets work |
| 18 | OPENROUTER_API_KEY completely missing prevents triage | Clear error message shown |

## Priority 6 — Image Size (dockerfiles.test.ts)

| # | Test | What to validate |
|---|------|-----------------|
| 19 | total docker image size should not exceed 2GB | `docker images` sum ≤ 2GB |

---

## How to implement

Once `docker compose up --build` works end-to-end:

1. Convert each `it.todo(...)` to a real `it(...)` with assertions
2. For tests needing Docker: use `execSync('docker ...')` in beforeAll/test
3. For tests needing HTTP: use `fetch` or `execSync('curl ...')`
4. Mark with `@integration` tag or put in separate test file for CI separation
5. Run with: `npx vitest run --reporter=verbose`
