# PROJECT_STATE

> Single source of truth for all spec status. Normally updated automatically by SpecSafe.
> Manual sync applied on 2026-04-08 per user request to reflect the current branch state.

## Active Specs

| ID | Name | Stage | Created | Description |
|----|------|-------|---------|-------------|
| SPEC-20260407-001 | infra-docker-k8s-init | CODE | 2026-04-07 | Infrastructure: Docker Compose (9 containers), K8s scaffolding, documentation templates |
| SPEC-20260408-001 | docker-compose-architecture-alignment | CODE | 2026-04-08 | Docker Compose update: two networks, dev/prod mode, Caddyfile env switching, config.json |
| SPEC-20260409-001 | better-auth-drizzle-libsql-auth | QA | 2026-04-09 | Better Auth + Drizzle/LibSQL: schema, Better Auth instance, drizzle-kit push, Zod schemas, route mounting in Mastra |
| SPEC-20260408-002 | linear-resend-integration-tools | CODE | 2026-04-08 | Linear ticketing tools, Resend email tools, shared schemas, and runtime integration tests |
| SPEC-20260408-003 | langfuse-observability-integration | CODE | 2026-04-08 | OpenRouter Broadcast + Langfuse SDK fallback, Cloudflare tunnel, trace verification |
| SPEC-20260409-002 | fe-auth-pages-login-register | COMPLETE | 2026-04-09 | Auth pages (login/register), Better Auth client SDK, auth guard, logout, neumorphic UX — 33 E2E tests passing |

## Integration Test Status

**File:** [specs/active/PENDING-INTEGRATION-TESTS.md](specs/active/PENDING-INTEGRATION-TESTS.md)

The 19 infrastructure scenarios previously tracked as pending are now implemented
as executable tests across the infra test suite.

- Default suite status: `npm test` passes
- Live Docker/Helm smoke assertions are opt-in via `RUN_MANUAL_INFRA_TESTS=1 npm test`
- Manual end-to-end smoke validation with `docker compose up --build` is still recommended before final hackathon submission

## Completed Specs

_No completed specs._

## Archived Specs

_No archived specs._