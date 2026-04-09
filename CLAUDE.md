# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Triage** is an AI-powered SRE incident triage agent for e-commerce (Solidus/Rails). Users describe incidents in chat (text + images), the agent queries a codebase wiki (llm-wiki RAG), identifies root cause with file references, creates a Linear ticket, notifies via email, and verifies resolution when the fix ships. Built for AgentX Hackathon 2026 (4 people, 48 hours).

## Build & Development Commands

```bash
# Start all 10 containers (dev mode — auto-loads docker-compose.override.yml)
docker compose up --build

# Production mode (for demo recording — skips override)
docker compose -f docker-compose.yml up --build

# Run tests
pnpm test
pnpm test --coverage

# Database: apply schema (idempotent, no migration files)
cd runtime && pnpm db:push

# Database: inspect with Drizzle Studio GUI
cd runtime && pnpm db:studio

# Database: raw drizzle-kit commands (alternative)
cd runtime && npx drizzle-kit push      # direct apply, no migration files
cd runtime && npx drizzle-kit studio    # connects via localhost:8080

# View logs
docker compose logs -f runtime
docker compose logs -f frontend
```

## Architecture

Two custom containers + 8 infrastructure containers behind a Caddy reverse proxy:

- **Frontend** (Caddy) — TanStack Router SPA + shadcn/ui. Caddy serves static files and reverse-proxies `/api/*` and `/auth/*` to runtime. Single-origin eliminates CORS.
- **Runtime** (Mastra on Hono) — agents, workflows, tools, Better Auth, webhooks. Mastra IS the HTTP server — no Express. Custom routes (auth, webhooks) register on Mastra.
- **LibSQL** (sqld) — storage + native F32_BLOB(1536) vector search via DiskANN. Serves 4 roles: workflow state, auth, wiki vectors, fallback tickets.
- **Langfuse stack** (6 containers) — observability with LangfuseExporter in Mastra. Exposed publicly via a `cloudflared` Cloudflare Tunnel at `https://langfuse.agenticengineering.lat`.

**Docker networks:** `app` (frontend, runtime, libsql) + `langfuse` (observability). Runtime joins both.

**Agent flow:** Frontend `useChat` → Orchestrator agent → `triageWorkflow` (as Mastra tool) → Triage Agent (within workflow step) → dedup → ticket card (two-phase: preview → user approves → confirmed) → Linear ticket → email → suspend → webhook resume → Resolution Reviewer → notify reporter.

**Full architecture:** `_bmad-output/planning-artifacts/architecture.md`

## Key Conventions

### Naming

| Context | Convention | Example |
|---------|-----------|---------|
| DB tables/columns | snake_case, plural | `wiki_documents`, `project_id` |
| TypeScript vars/functions | camelCase | `getTriageResult` |
| Types/interfaces | PascalCase | `TriageOutput` |
| Zod schemas | camelCase + Schema | `triageOutputSchema` |
| Constants | UPPER_SNAKE_CASE | `MAX_FILE_SIZE` |
| All file names | kebab-case | `triage-agent.ts`, `ticket-card.tsx` |
| Env vars | SERVICE_PURPOSE | `OPENROUTER_API_KEY` |
| Mastra exports | named camelCase | `export const triageAgent = new Agent(...)` |

### Patterns

- **Zod schemas split by domain** in `runtime/src/lib/schemas/{triage,ticket,wiki}.ts` — never duplicate schemas inline
- **Tool-level error boundaries** — each Mastra tool wraps in try/catch, returns `{ success: false, error: "..." }`. Internal code can throw. One catch per tool, not per DB query.
- **API response format** (non-streaming): `{ success: true, data: T }` or `{ success: false, error: { code, message } }`
- **Barrel files** ONLY in `src/mastra/{agents,tools,workflows}/index.ts` — required for Mastra registration. Nowhere else.
- **Co-located tests** — `file.test.ts` next to `file.ts`. Prioritize schema validation and tool error path tests.
- **One file per concern** — all Linear tools in `linear.ts`, not split per function.
- **Dates:** ISO 8601 strings in APIs. Frontend formats with `Intl.DateTimeFormat`.
- **Nulls:** `null` for absent values in APIs, never `undefined`.
- **Drizzle ORM:** dialect is `'turso'` in drizzle.config.ts; runtime imports from `drizzle-orm/libsql`. Better Auth uses `provider: 'sqlite'` (not 'turso').

### Anti-Patterns

- No Redux/Zustand — `useChat` + TanStack Query is sufficient
- No Express — Mastra is the HTTP server (Hono). Use Hono if external server needed.
- No Helmet.js — Caddy handles all security headers
- No `utils/` or `helpers/` — use `lib/` with descriptive filenames
- No `index.ts` barrel files except in Mastra subdirectories
- No `any` type — all data boundaries must have Zod schemas
- No wrapper abstractions around Mastra, AI SDK, or Better Auth

### Graceful Degradation

All external services have fallback modes. Failures never block triage:
- Linear unavailable → tickets stored in local LibSQL `local_tickets` table
- Resend down → email skipped, logged
- OpenRouter down → fallback model routing

### Security Processor Pipeline Order

1. Prompt injection detector (block, threshold 0.7)
2. PII redactor (redact emails, API keys)
3. System prompt scrubber (filter outputs)
4. DOMPurify (frontend HTML sanitization)
5. Caddy security headers (HSTS, X-Frame-Options, CSP, etc.)

## Key Files

| File | Purpose |
|------|---------|
| `_bmad-output/planning-artifacts/architecture.md` | Complete architecture decisions, patterns, structure |
| `_bmad-output/planning-artifacts/prd.md` | 52 FRs, 37 NFRs, 5 user journeys |
| `.env.example` | Canonical env var reference — add new vars here immediately |
| `docker-compose.yml` | 10 containers, 2 networks, named volume |
| `docker-compose.override.yml` | Dev mode: Vite HMR + tsx --watch |
| `Caddyfile` | Reverse proxy, security headers, SPA routing |
| `PROJECT_STATE.md` | SpecSafe spec status tracker |
| `runtime/src/db/schema.ts` | Drizzle ORM schema: auth tables, wiki_documents, wiki_chunks (F32_BLOB vectors), local_tickets |
| `runtime/src/db/client.ts` | LibSQL client + Drizzle ORM instance (dialect: turso, import from drizzle-orm/libsql) |
| `runtime/src/lib/auth.ts` | Better Auth server config (provider: sqlite, backed by LibSQL) |
| `runtime/drizzle.config.ts` | Drizzle-kit config (dialect: turso, schema path, dbCredentials) |

## Team & Assignments

Fernando (infra/platform), Lalo (workflows/agents), Koki (runtime/integrations), Chenko (frontend). Linear team: `triage-hackathon`.

---

## SpecSafe — Two-Phase Workflow Rules

SpecSafe is a two-phase software engineering framework. Phase 1 (Planning) reduces ambiguity before implementation. Phase 2 (Development) enforces strict test-driven execution through small spec slices. No stage may be skipped. Each stage has a dedicated skill and persona.

### Phase 1: Planning

| Step | Skill | What Happens |
|------|-------|--------------|
| 1 | `specsafe-brainstorm` | Divergent exploration of possibilities |
| 2 | `specsafe-principles` | Product principles, non-goals, quality priorities |
| 3 | `specsafe-brief` | Concise product/business framing document |
| 4 | `specsafe-prd` | Testable requirements with user journeys and acceptance criteria |
| 5 | `specsafe-ux` | UX design: tokens, components, flows, accessibility |
| 6 | `specsafe-architecture` | System architecture with ADRs and technology decisions |
| 7 | `specsafe-readiness` | Pre-development coherence check |

Canonical order: brainstorm → principles → brief → PRD → UX → architecture → readiness. UX always precedes architecture.

### Phase 2: Development Stages

| Stage | Skill | Persona | What Happens |
|-------|-------|---------|--------------| 
| SPEC | `specsafe-new`, `specsafe-spec` | Mason (Kai) | Create and refine specification with requirements and scenarios |
| TEST | `specsafe-test` | Forge (Reva) | Generate test files from spec scenarios (all tests fail) |
| CODE | `specsafe-code` | Bolt (Zane) | Implement code using TDD red-green-refactor |
| QA | `specsafe-verify`, `specsafe-qa` | Warden (Lyra) | Validate tests pass, check coverage, generate QA report |
| COMPLETE | `specsafe-complete` | Herald (Cass) | Human approval gate, move to completed |

### Project Constraints

1. **Always read `PROJECT_STATE.md` first** — before any skill invocation, check current state
2. **Never modify `PROJECT_STATE.md` directly** — only update it through skill workflows
3. **Tests define implementation** — code exists only to make tests pass
4. **One spec at a time** — complete or park a spec before starting another
5. **No stage skipping** — every spec must progress through all 5 development stages in order
6. **Evidence required** — QA verdicts require concrete test evidence, not assertions
7. **Normative language** — specs use SHALL/MUST/SHOULD per RFC 2119
8. **Planning precedes development** — reduce ambiguity before writing code
