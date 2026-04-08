---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
lastStep: 8
status: 'complete'
completedAt: '2026-04-08'
inputDocuments:
  - _bmad-output/planning-artifacts/prd.md
  - _bmad-output/planning-artifacts/product-brief-triage.md
  - _bmad-output/planning-artifacts/product-brief-triage-distillate.md
  - HACKATHON_BRAINSTORM_OUTPUT/08-session2-sre-agent.md
  - HACKATHON_BRAINSTORM_OUTPUT/09-team-assignments-v2.md
  - HACKATHON_BRAINSTORM_OUTPUT/10-risk-matrix.md
  - HACKATHON_BRAINSTORM_OUTPUT/11-tech-stack-final.md
  - HACKATHON_BRAINSTORM_OUTPUT/12-research-findings.md
  - HACKATHON_BRAINSTORM_OUTPUT/13-linear-tasks.md
workflowType: 'architecture'
project_name: 'triage'
user_name: 'Fr'
date: '2026-04-07'
---

# Architecture Decision Document

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

## Project Context Analysis

### Requirements Overview

**Functional Requirements:**
52 FRs across 8 domains. The architectural spine is the triage workflow: multimodal intake (FR1-FR7) → codebase RAG query (FR8-FR12) → structured triage output (FR13-FR18) → ticket creation with approval gate and dedup (FR19-FR27) → email notification (FR28-FR31) → suspend for resolution → webhook resume → PR/commit verification (FR32-FR37). User/project management (FR38-FR42) and observability/security (FR43-FR48) are cross-cutting. Error handling (FR49-FR52) enforces durable execution and graceful degradation.

**Non-Functional Requirements:**
37 NFRs that directly shape architecture:
- **Performance:** <2s first token, <60s full triage, <5min wiki generation, <2s page load
- **Security:** Prompt injection detection, PII redaction, system prompt scrub, DOMPurify, secure cookies, file validation (10MB/file, 25MB/message)
- **Scalability:** Single docker compose up, stateless/stateful container separation, <2GB total image pull
- **Reliability:** Durable workflow state in LibSQL, auto-retry with delay, graceful degradation on all external services, Zod schema validation on all structured output
- **Observability:** End-to-end Langfuse traces with correlation IDs, token cost tracking, security event logging
- **Integration:** Linear SDK as Mastra tools, webhook REST endpoint, Resend API, configurable LLM provider, mock/fallback for all external services
- **Documentation:** README, AGENTS_USE.md (evidence screenshots), SCALING.md, QUICKGUIDE.md

**Scale & Complexity:**

- Primary domain: Full-stack web application (SPA + agent orchestration backend + vector DB)
- Complexity level: Medium-High
- Estimated architectural components: ~12 (Caddy proxy, SPA frontend, Mastra runtime, 3 agents, workflow engine, LibSQL + vectors, Better Auth, Linear integration, Resend integration, Langfuse observability, security processor pipeline)

### Technical Constraints & Dependencies

- **Tech stack locked:** Mastra v1.23, LibSQL (sqld), Drizzle ORM, Better Auth, Caddy, TanStack, AI SDK, OpenRouter, Langfuse, Linear SDK, Resend — all decisions final
- **Container budget:** 9 containers, ~1.6GB pull, must start with single `docker compose up --build`
- **LLM provider:** OpenRouter free tier (Qwen 3.6 Plus multimodal) default, Mercury paid for demo. Images only for MVP — no video processing.
- **Single-origin mandatory:** Caddy serves SPA + proxies API/auth. No CORS. Session cookies work automatically.
- **Team parallelism:** Architecture must enable Lucy (infra), Coqui (runtime/integrations), Lalo (workflows/agents), Chenko (frontend) to work independently from Day 1
- **Critical path:** Docker Compose → Mastra Runtime → Linear Integration → Workflow → Triage Agent → Resolution Flow
- **Parallel path:** Docker Compose → Better Auth → Chat UI → Ticket Cards

### Cross-Cutting Concerns Identified

- **Correlation ID propagation:** From chat message through workflow steps, agent calls, tool invocations, external API calls, to resolution verification — must be traceable in Langfuse as a single connected trace
- **Graceful degradation:** Every external service (Linear, Resend, OpenRouter) needs real integration + fallback mode. Pattern: try real → catch → log + fallback behavior. Email failure never blocks triage. Missing Linear key → local DB tickets.
- **Security processor pipeline:** All user input passes through: prompt injection detector → PII redactor → system prompt scrubber → DOMPurify. Order matters — injection check before any processing.
- **Structured output validation:** All agent outputs validated against Zod schemas. Prevents LLM response variance from breaking downstream consumers (ticket creation, UI rendering, notifications).
- **State persistence:** LibSQL serves 4 roles: workflow state (Mastra), user auth (Better Auth/Drizzle), vector embeddings (wiki RAG), and fallback ticket storage. Schema must accommodate all four without conflicts.
- **Error boundary design:** File upload errors surface in composer (pre-send). Triage errors surface in chat stream (post-send). Workflow errors retry once, then error state. External service errors degrade gracefully. Each has a distinct UI treatment.

## Project Initialization

### Primary Technology Domain

Full-stack web application: agent orchestration backend (Mastra/Node.js) + SPA frontend (React/Vite/TanStack) + LibSQL database. All technology decisions are locked per team brainstorming — this section documents the initialization approach, not the selection rationale.

### Initialization Approach

This project has two custom containers with separate initialization paths:

#### Runtime Container — Mastra Agent Backend

**Initialization Command:**

```bash
npm create mastra@latest triage-runtime -- \
  --components agents,tools,workflows \
  --no-example \
  --src src/
```

**First Configuration Step (Day 1 smoke test blocker):**
Configure `@openrouter/ai-sdk-provider` as the LLM provider. `create-mastra` does not have an OpenRouter provider flag — this must be set up manually in `src/mastra/index.ts` immediately after scaffold. Verify multimodal response (text + image) before proceeding to any agent work.

**Post-scaffold additions:**
- `@mastra/libsql` — storage + vector search (LibSQLStore, LibSQLVector)
- `@linear/sdk`, `@mastra/mcp` — ticketing integration wrapped as Mastra tools + MCP
- `resend` — email notifications
- `better-auth` — authentication (embedded in runtime, not standalone)
- `drizzle-orm`, `@libsql/client` — ORM for Better Auth + app tables
- `drizzle-kit` (dev) — schema generation and migrations
- `dompurify` — XSS prevention (no Helmet.js — Caddy handles security headers)
- `langfuse` — `LangfuseExporter` for observability
- `zod` — structured output schemas (included with Mastra)

**Full Runtime Directory Structure (Mastra + non-Mastra artifacts):**

```
src/
├── mastra/              ← scaffolded by create-mastra
│   ├── index.ts         ← Mastra instance config (LLM provider, storage, exporter)
│   ├── agents/          ← Orchestrator, Triage Agent, Resolution Reviewer
│   ├── tools/           ← Linear, Resend, wiki query tools
│   └── workflows/       ← triage E2E workflow (intake → resolve)
├── auth/                ← Better Auth config (not a Mastra artifact)
│   └── index.ts         ← auth instance, Drizzle adapter, cookie config
├── db/
│   ├── schema.ts        ← Drizzle schema (auth tables + app tables + fallback tickets)
│   └── client.ts        ← LibSQL connection singleton
├── webhooks/            ← Linear webhook handler (workflow resume endpoint)
│   └── linear.ts
└── lib/                 ← shared utilities, Zod schemas for structured output
    ├── schemas/
    │   ├── triage.ts
    │   ├── ticket.ts
    │   └── wiki.ts
    └── config.ts
drizzle.config.ts        ← root level, dialect: "turso"
Dockerfile
```

**Architectural Decisions Provided by Starter:**
- Project structure: `src/mastra/{agents,tools,workflows}/`
- TypeScript configuration for Node.js runtime
- Mastra instance configuration pattern (`src/mastra/index.ts`)
- Agent endpoint exposure (HTTP)

**Drizzle Setup (owned by runtime):**
- `drizzle.config.ts` at project root with `dialect: "turso"`, schema path `src/db/schema.ts`, migrations output to `drizzle/`
- Commands: `drizzle-kit generate`, `drizzle-kit push`, `drizzle-kit studio`

#### Frontend Container — TanStack SPA

**Initialization Command:**

```bash
npx shadcn@latest init --template vite
```

**Post-scaffold additions:**
- `@tanstack/react-router`, `@tanstack/react-query` — file-based routing + server state
- `@tanstack/router-plugin` (dev) — Vite plugin for file-based route generation
- `@ai-sdk/react` — `useChat` hook for chat streaming
- Additional shadcn/ui components as needed (Card, Badge, Separator, Skeleton, etc.)

**Critical post-scaffold config — TanStack Router Vite plugin:**

```ts
// vite.config.ts — must be modified after scaffold
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [TanStackRouterVite(), react()],
})
```

This enables file-based routing (`/chat`, `/board`) and is a build pipeline change, not just a dependency add.

**Architectural Decisions Provided by Starter:**
- Vite build tooling with React plugin
- Tailwind CSS v4 configuration
- shadcn/ui component library with Radix UI primitives (keyboard navigation, ARIA, focus management)
- TypeScript configuration for browser runtime
- Project structure with `src/components/ui/` for shadcn components

#### Infrastructure: Docker Compose

No starter template — manually composed `docker-compose.yml` defining all 9 containers. Langfuse stack derived from official Langfuse Docker Compose reference. Caddy configured via `Caddyfile`.

All remaining architectural decisions — container networking, Caddyfile, agent contracts, workflow definitions, data model, security pipeline — are defined in subsequent sections.

## Core Architectural Decisions

### Decision Priority Analysis

**Critical Decisions (Block Implementation):**
- Vector embedding model and dimensions (affects wiki pipeline + LibSQL schema)
- Wiki storage schema (affects triage agent RAG queries)
- Webhook ingress strategy (affects resolution verification flow)
- Docker network topology (affects container communication)

**Important Decisions (Shape Architecture):**
- Security header consolidation (Caddy vs Helmet.js)
- Error response format (API consistency)
- Generative UI component mapping (frontend rendering)
- Session duration (auth UX)

**Deferred Decisions (Post-MVP):**
- Kubernetes service mesh and ingress configuration (SCALING.md)
- TLS certificate management for production (Caddy auto-HTTPS — one-line Caddyfile change)
- Rate limiting on LLM calls (monitor costs first)
- Wiki refresh strategy (webhook on repo push vs periodic)

### Data Architecture

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Embedding model | `text-embedding-3-small` via OpenRouter | 1536 dims, $0.02/M tokens, standard quality/performance balance |
| Vector dimensions | `F32_BLOB(1536)` | Matches text-embedding-3-small output. LibSQL DiskANN handles natively. |
| Migration strategy | `drizzle-kit push` (direct apply) | No migration files. Single instance, 48-hour build. `drizzle-kit studio` for inspection. |
| Wiki storage | Two tables: `wiki_documents` (file metadata) + `wiki_chunks` (content + embeddings) | Chunk-level granularity for precise RAG retrieval. Join to document for file context. |

**Wiki Tables Schema:**
- `wiki_documents`: id, projectId, filePath, summary, pass (1=per-file, 2=synthesis), createdAt
- `wiki_chunks`: id, documentId, content (text), embedding (F32_BLOB(1536)), chunkIndex, createdAt
- RAG query: `vector_top_k('wiki_chunks_idx', queryEmbedding, 10)` → join `wiki_documents` for file paths

### Authentication & Security

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Security headers | Caddy only (drop Helmet.js) | All traffic flows through Caddy. One config point. Runtime never browser-exposed. |
| Prompt injection threshold | 0.7 (block strategy) | Rejects input with generic message. Logged to Langfuse for evidence. |
| PII redaction | Mastra processor (redact strategy) | Emails and API keys redacted before LLM context. |
| System prompt scrub | Mastra processor (filter strategy) | Prevents prompt extraction from outputs. |
| Session duration | 7 days, no sliding window | No logout during hackathon build/demo. HttpOnly, SameSite=Lax, Secure in prod. |
| File validation | Client-side (composer) + server-side (runtime) | 10MB/file, 25MB/message. Type whitelist: png, jpg, gif, log, txt, mp4, webm. |

**Security processor pipeline order:**
1. Prompt injection detector (block) — reject malicious input before any processing
2. PII redactor (redact) — strip sensitive data before LLM sees it
3. System prompt scrubber (filter) — clean outputs before they reach the user
4. DOMPurify — sanitize any HTML in rendered content (frontend-side)
5. Caddy security headers — HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, CSP

### API & Communication Patterns

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Chat streaming | AI SDK SSE protocol via Mastra agent endpoints | Native integration. useChat → /api/agents/:agentId/stream. Caddy `flush_interval -1` for unbuffered SSE. |
| Webhook ingress | Cloudflare Tunnel (primary) + mock trigger button (fallback) | Tunnel is easy to configure and reliable. Mock button calls same resume endpoint — identical code path, useful for demo reliability. |
| Error response format | `{ success, data?, error?: { code, message } }` | All non-streaming endpoints (webhooks, health, auth). Consistent, no framework. |
| Health checks | `/health` on runtime (verifies LibSQL), built-in on Caddy, native on sqld | Docker Compose healthcheck blocks. All containers report healthy. |

### Frontend Architecture

| Decision | Choice | Rationale |
|----------|--------|-----------|
| State management | useChat (chat), TanStack Query (server data), no global store | Three state domains, each with its own manager. No Redux/Zustand. |
| Generative UI registry | Static `Record<string, ComponentType>` map | 2-3 tool types. displayTicket → TicketCard, displayDuplicate → DuplicatePrompt. No dynamic registry. |
| Route lazy loading | `/board` route lazy-loaded via TanStack Router `lazy()` | Reduces initial bundle from ~300KB to ~180-200KB gzipped. /board loads on-demand. |
| Ticket card rendering | Card renders only after Linear ticket confirmed created | If Linear API fails → error card, not an orphan card. Approve/Create button flow. |

### Infrastructure & Deployment

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Docker networks | Two: `app` (frontend, runtime, libsql) + `langfuse` (6 langfuse containers). Runtime joins both. | Clean separation. Langfuse infra doesn't pollute app DNS. |
| LibSQL persistence | Named volume `libsql-data` mounted to `/var/lib/sqld` | Survives `docker compose down`. No host permission issues. |
| Caddy TLS | HTTP only for local dev. Production: change site address to real domain — Caddy auto-provisions Let's Encrypt (one-line Caddyfile change). | Localhost doesn't need TLS. Production path is a config change, not a code change. |
| Environment config | `.env` file loaded by Docker Compose. `.env.example` in repo. | Single source for all secrets. Never committed. Runtime reads via `process.env`. |
| Frontend config injection | Caddy serves `/config.json` (API URL, feature flags) | No rebuild when API URL changes between environments. SPA fetches on boot. |
| HTTP server | Mastra is the HTTP server (built on Hono). Custom routes (auth, webhooks) registered on Mastra. No Express. If external server ever needed, use Hono. | Mastra already provides HTTP via `mastra.serve()`. Adding Express is redundant. |
| Caddyfile delivery | Volume mount in docker-compose referencing `./Caddyfile` at repo root | Not baked into Dockerfile. Allows config changes without rebuild. |
| LibSQL port | Exposed to host (`ports: ["8080:8080"]`) for `drizzle-kit studio` access | Devs run `cd runtime && npx drizzle-kit studio` on host, connects via `localhost:8080`. `LIBSQL_URL` env var: `http://libsql:8080` in Docker, falls back to `http://localhost:8080` on host. |

### Decision Impact Analysis

**Implementation Sequence:**
1. Docker Compose + networks + volumes (Fernando — Day 1, hours 0-2)
2. LibSQL schema via drizzle-kit push (Fernando/Koki — Day 1, hours 0-2)
3. Better Auth config with session settings (Chenko — Day 1, hours 2-4)
4. Mastra runtime + OpenRouter provider (Lalo — Day 1, hours 0-4)
5. Security processor pipeline (Koki — Day 1, hours 8+)
6. Caddy security headers in Caddyfile (Fernando — Day 1, hours 2-4)
7. Wiki pipeline with chunk storage (Koki — Day 1-2)
8. Tool component registry on frontend (Koki/Chenko — Day 1, hours 8+)
9. Cloudflare Tunnel for webhook ingress (Lalo — Day 2)

**Cross-Component Dependencies:**
- Wiki chunk schema → embedding dimensions → embedding model choice (all locked: 1536, text-embedding-3-small)
- Security headers in Caddy → no Helmet.js on runtime (removes a dependency from runtime Dockerfile)
- Named volume for LibSQL → all containers sharing DB reference same data across restarts
- Two Docker networks → runtime must explicitly join both `app` and `langfuse` networks in compose
- Cloudflare Tunnel → same resume endpoint as mock button → no code divergence between live and demo

## Implementation Patterns & Consistency Rules

### Critical Conflict Points Identified

12 areas where AI agents working on different parts of the codebase could make incompatible choices. These patterns ensure code from Fernando (infra), Lalo (agents/workflows), Koki (runtime/integrations), and Chenko (frontend) integrates cleanly.

### Naming Patterns

**Database Naming (Drizzle + LibSQL):**
- Tables: `snake_case`, plural — `wiki_documents`, `wiki_chunks`, `local_tickets`
- Columns: `snake_case` — `project_id`, `file_path`, `created_at`
- Foreign keys: `{referenced_table_singular}_id` — `document_id`, `user_id`
- Indexes: `idx_{table}_{column}` — `idx_wiki_chunks_document_id`
- Better Auth tables: use Better Auth's own naming (it generates `user`, `session`, `account`, `verification` tables) — do NOT rename
- Exception: F32_BLOB vector columns use `embedding` (no prefix)

**API Naming:**
- Mastra agent endpoints: follow Mastra conventions — `/api/agents/:agentId/stream`, `/api/agents/:agentId/generate`
- Webhook endpoints: `/api/webhooks/linear`
- Workflow resume: `/api/workflows/:workflowId/resume`
- Health: `/health`
- Auth: `/auth/*` (Better Auth owns this namespace)
- Custom endpoints: `/api/{resource}` — kebab-case, plural nouns — `/api/wiki-documents`

**Environment Variable Naming:**
- Convention: `{SERVICE}_{PURPOSE}` — all caps, underscore separated
- Examples: `OPENROUTER_API_KEY`, `LINEAR_API_KEY`, `RESEND_API_KEY`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `LIBSQL_URL`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASEURL`
- `.env.example` is the canonical reference — any new env var MUST be added there immediately
- Never commit `.env` — only `.env.example` with placeholder values

**Code Naming (TypeScript):**
- Variables/functions: `camelCase` — `getTriageResult`, `userId`
- Types/interfaces: `PascalCase` — `TriageOutput`, `WikiDocument`
- Zod schemas: `camelCase` with `Schema` suffix — `triageOutputSchema`, `ticketCreateSchema`
- Constants: `UPPER_SNAKE_CASE` — `MAX_FILE_SIZE`, `PROMPT_INJECTION_THRESHOLD`
- Files: `kebab-case` everywhere — `triage-agent.ts`, `wiki-query.ts`, `ticket-card.tsx`
- React components: `kebab-case` files, `PascalCase` exports — file `ticket-card.tsx` exports `TicketCard` (follows shadcn/ui convention)
- Directories: `kebab-case`
- Mastra agents: named exports — `export const triageAgent = new Agent({...})`
- Mastra tools: named exports — `export const queryWikiTool = createTool({...})`
- Mastra workflows: named exports — `export const triageWorkflow = new Workflow({...})`

### Structure Patterns

**Runtime Container (`/runtime`):**
```
src/
├── mastra/
│   ├── index.ts              ← Mastra instance (single export)
│   ├── agents/
│   │   ├── index.ts          ← barrel re-export (Mastra registration)
│   │   ├── orchestrator.ts
│   │   ├── triage-agent.ts
│   │   └── resolution-reviewer.ts
│   ├── tools/
│   │   ├── index.ts          ← barrel re-export (Mastra registration)
│   │   ├── linear.ts         ← all Linear tools in one file
│   │   ├── resend.ts         ← all email tools in one file
│   │   └── wiki-query.ts     ← RAG query tool
│   └── workflows/
│       ├── index.ts          ← barrel re-export (Mastra registration)
│       └── triage-workflow.ts
├── auth/
│   └── index.ts
├── db/
│   ├── schema.ts             ← ALL Drizzle tables in one file
│   └── client.ts
├── webhooks/
│   └── linear.ts
└── lib/
    ├── schemas/              ← Zod schemas split by domain
    │   ├── triage.ts         ← TriageOutput, severity, priority
    │   ├── ticket.ts         ← TicketCreate, DuplicateCheck
    │   └── wiki.ts           ← WikiDocument, WikiChunk
    └── config.ts             ← env var validation + typed config
```

**Frontend Container (`/frontend`):**
```
src/
├── routes/
│   ├── __root.tsx            ← layout, auth guard
│   ├── chat.tsx              ← /chat route
│   └── board.lazy.tsx        ← /board route (lazy loaded)
├── components/
│   ├── ui/                   ← shadcn/ui primitives (auto-generated, kebab-case)
│   ├── chat/
│   │   ├── chat-input.tsx
│   │   ├── message-list.tsx
│   │   └── file-preview.tsx
│   ├── ticket/
│   │   ├── ticket-card.tsx
│   │   └── duplicate-prompt.tsx
│   └── board/
│       └── kanban-board.tsx
├── lib/
│   ├── tool-registry.ts      ← static Record<string, ComponentType>
│   ├── api.ts                ← TanStack Query functions
│   └── config.ts             ← fetch /config.json on boot
└── hooks/
    └── use-auth.ts           ← Better Auth client hook
```

**Barrel Files:** ONLY allowed in `src/mastra/{agents,tools,workflows}/index.ts` — required for Mastra's tool/agent registration pattern. Nowhere else in the codebase. Import directly from source files everywhere else.

**Tests:** Co-located — `triage-agent.test.ts` next to `triage-agent.ts`. No separate `__tests__/` directory. If you write a test, prioritize: (1) Zod schema validation tests, (2) tool error path tests. These two prevent silent integration breakage between developers.

**One file per concern, not per function:** All Linear tools in `linear.ts`, not `create-issue.ts` + `update-issue.ts` + `get-issue.ts`. A file should contain a cohesive unit, not a single export.

### Format Patterns

**API Response Format (non-streaming endpoints):**
```ts
// Success
{ success: true, data: T }

// Error
{ success: false, error: { code: string, message: string } }
```
HTTP status codes: 200 (success), 400 (bad request), 401 (unauthorized), 404 (not found), 500 (server error). No 201/204 distinction — keep it simple.

**JSON Field Naming:** `camelCase` in all API responses and request bodies. Drizzle handles snake_case → camelCase mapping in the ORM layer. Frontend never sees snake_case.

**Date Format:** ISO 8601 strings in all APIs — `2026-04-08T14:30:00.000Z`. No Unix timestamps. No formatted date strings. Frontend formats for display using `Intl.DateTimeFormat`.

**Null Handling:** Use `null` for absent values, never `undefined` in API responses. Drizzle nullable columns map to `null`. Frontend checks `value !== null`.

### Communication Patterns

**Mastra Workflow Step Communication:**
- Each workflow step receives typed input and returns typed output (Zod schemas from `lib/schemas/`)
- Step output becomes next step's input — no side channels
- Suspend payload uses `suspendSchema`, resume uses `resumeSchema`
- Schemas imported from domain-specific files in `lib/schemas/`

**Agent Tool Error Boundary:**
- **Tools are the error boundary.** Each tool wraps its internal logic in a try/catch and returns `{ success: false, error: "..." }` on failure.
- Code inside tools (DB queries, API calls) can throw normally — the tool catches.
- Calling code (workflow steps, agents) checks the `success` field before proceeding.
- Do NOT write try/catch inside every DB query within a tool — that's noise. One try/catch at the tool level.

```ts
// CORRECT: tool-level error boundary
export const createLinearTicket = createTool({
  // ...
  execute: async ({ context }) => {
    try {
      const issue = await linearClient.createIssue(context);
      return { success: true, data: issue };
    } catch (error) {
      return { success: false, error: `Linear API error: ${error.message}` };
    }
  },
});
```

**Frontend ↔ Runtime:**
- Chat: AI SDK SSE protocol exclusively (useChat ↔ Mastra agent stream endpoint)
- Data: TanStack Query with `queryFn` calling `/api/*` endpoints
- Auth: Better Auth client SDK handles `/auth/*` routes automatically
- No direct WebSocket connections. No custom SSE implementations.

### Process Patterns

**Error Handling by Layer:**

| Layer | Pattern | Example |
|-------|---------|---------|
| Mastra tools | Tool-level try/catch → return error object | `return { success: false, error: "Linear API timeout" }` |
| Workflow steps | Check tool result, log failure, continue or fail step | Email fails → log, continue. Ticket creation fails → fail step, retry once. |
| API endpoints | Try/catch → `{ success: false, error: { code, message } }` | Webhook handler catches errors, returns 500 with structured error |
| Frontend API calls | TanStack Query `onError` → toast notification | Failed Linear fetch → "Could not load board data" toast |
| Frontend chat | AI SDK error handling → error card in chat stream | Triage failure → retry once → error card with "Try again" button |

**Loading States:**
- Chat: AI SDK manages streaming state. `isLoading` from `useChat` drives send button disabled state.
- Kanban: TanStack Query `isLoading` / `isFetching` drives skeleton/spinner
- No global loading state. Each feature manages its own.

**Logging:**
- Runtime: `console.log` for info, `console.error` for errors (Langfuse captures traces separately)
- Always include correlation ID in log messages when available
- Never log secrets, API keys, or full user input (PII redaction happens before logging)
- Security events (injection blocked, PII redacted): log at `warn` level with event type for AGENTS_USE.md evidence

### Enforcement Guidelines

**All AI Agents MUST:**
1. Follow naming patterns exactly — database snake_case, TypeScript camelCase, files kebab-case everywhere
2. Use Zod schemas from `src/lib/schemas/{domain}.ts` — never define duplicate schemas inline
3. Implement tool-level error boundaries — tools catch, internal code can throw
4. Use the established API response format for all non-streaming endpoints
5. Co-locate tests next to source files, prioritize schema and error path tests
6. Keep one cohesive concern per file (all Linear tools in one file, not split)
7. Add any new env var to `.env.example` immediately with `{SERVICE}_{PURPOSE}` naming

**Anti-Patterns (DO NOT):**
- Create a `utils/` or `helpers/` directory — use `lib/` with descriptive filenames
- Add Redux, Zustand, or any global state — useChat + TanStack Query is sufficient
- Use `any` type — all data boundaries must have Zod schemas
- Create wrapper abstractions around Mastra, AI SDK, or Better Auth — use them directly
- Add `index.ts` barrel files except in `src/mastra/{agents,tools,workflows}/`
- Use PascalCase for file names — kebab-case everywhere, PascalCase only for exports
- Write try/catch inside every DB query within a tool — one try/catch at the tool level
- Add Express — Mastra is the HTTP server (built on Hono). Use Hono if external server ever needed.

## Project Structure & Boundaries

### Complete Repository Structure

```
triage/
├── docker-compose.yml            ← 9 containers, 2 networks, 1 named volume
├── docker-compose.override.yml   ← dev mode (auto-loads): Vite dev + tsx --watch runtime
├── .env.example                  ← canonical env var reference
├── .gitignore
├── .dockerignore                 ← excludes _bmad-output/, HACKATHON_BRAINSTORM_OUTPUT/, node_modules/
├── LICENSE                       ← MIT
├── README.md
├── AGENTS_USE.md
├── SCALING.md
├── QUICKGUIDE.md
├── Caddyfile                     ← volume-mounted; env var CADDY_MODE switches static serve vs Vite proxy
│
├── runtime/                      ← Mastra agent backend (custom container)
│   ├── Dockerfile
│   ├── package.json
│   ├── tsconfig.json
│   ├── drizzle.config.ts
│   └── src/
│       ├── index.ts              ← Mastra HTTP server entry (mastra.serve() + custom routes)
│       ├── mastra/
│       │   ├── index.ts          ← Mastra instance (LLM, storage, exporter, processors)
│       │   ├── agents/
│       │   │   ├── index.ts      ← barrel (Mastra registration)
│       │   │   ├── orchestrator.ts
│       │   │   ├── triage-agent.ts
│       │   │   └── resolution-reviewer.ts
│       │   ├── tools/
│       │   │   ├── index.ts      ← barrel (Mastra registration)
│       │   │   ├── linear.ts     ← createIssue, updateIssue, getIssue, listIssues, getTeamMembers
│       │   │   ├── resend.ts     ← sendTicketEmail, sendResolutionEmail
│       │   │   ├── wiki-query.ts ← queryWiki (RAG via LibSQLVector)
│       │   │   └── wiki-generate.ts ← two-pass wiki generation (per-file → synthesis → embed → store)
│       │   └── workflows/
│       │       ├── index.ts      ← barrel (Mastra registration)
│       │       ├── triage-workflow.ts  ← intake→triage→dedup→ticket→notify→suspend→verify→notify
│       │       └── wiki-generation-workflow.ts ← repo connect → two-pass analysis → embed → store
│       ├── auth/
│       │   └── index.ts          ← Better Auth instance, Drizzle adapter, cookie config
│       ├── db/
│       │   ├── schema.ts         ← ALL Drizzle tables in one file
│       │   └── client.ts         ← LibSQL connection singleton
│       ├── webhooks/
│       │   └── linear.ts         ← POST handler → workflow resume
│       └── lib/
│           ├── schemas/
│           │   ├── triage.ts     ← triageOutputSchema, severitySchema, prioritySchema
│           │   ├── ticket.ts     ← ticketCreateSchema, duplicateCheckSchema
│           │   └── wiki.ts       ← wikiDocumentSchema, wikiChunkSchema
│           └── config.ts         ← env var validation (Zod), typed config export
│
├── frontend/                     ← TanStack SPA (built, served by Caddy)
│   ├── Dockerfile                ← multi-stage: build → copy dist/ to Caddy image
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts            ← TanStackRouterVite() + react()
│   ├── components.json           ← shadcn/ui config
│   └── src/
│       ├── main.tsx              ← app entry, router init
│       ├── routes/
│       │   ├── __root.tsx        ← layout shell, auth guard, config fetch
│       │   ├── chat.tsx          ← /chat — primary route
│       │   └── board.lazy.tsx    ← /board — lazy loaded kanban
│       ├── components/
│       │   ├── ui/               ← shadcn/ui primitives (auto-generated)
│       │   ├── chat/
│       │   │   ├── chat-input.tsx       ← text + paste + file upload + send
│       │   │   ├── message-list.tsx     ← message.parts rendering + tool components
│       │   │   └── file-preview.tsx     ← removable thumbnails, size badges
│       │   ├── ticket/
│       │   │   ├── ticket-card.tsx      ← triage output card (severity, confidence, link)
│       │   │   └── duplicate-prompt.tsx ← "update existing or create new?"
│       │   └── board/
│       │       └── kanban-board.tsx     ← columns from Linear, read-only
│       ├── lib/
│       │   ├── tool-registry.ts  ← Record<string, ComponentType> map
│       │   ├── api.ts            ← TanStack Query queryFn wrappers
│       │   └── config.ts         ← fetch /config.json, export typed config
│       └── hooks/
│           └── use-auth.ts       ← Better Auth client, session state
│
├── _bmad-output/                 ← planning artifacts (not deployed, in .dockerignore)
└── HACKATHON_BRAINSTORM_OUTPUT/  ← brainstorm artifacts (not deployed, in .dockerignore)
```

### Architectural Boundaries

**Container Boundaries (Docker network `app`):**

```
Browser ──→ Caddy (:80) ──┬── /api/*  ──→ Runtime (:3000)
                          ├── /auth/* ──→ Runtime (:3000)
                          └── /*      ──→ Static SPA files

Runtime (:3000) ──→ LibSQL (:8080)       [app network]
Runtime (:3000) ──→ Langfuse Web (:3001) [langfuse network]

Host ──→ LibSQL (:8080)                  [exposed port for drizzle-kit studio]
```

- **Caddy** is the ONLY entry point for browsers. No container port is exposed to the host except Caddy's port 80 and LibSQL's port 8080 (for dev tooling).
- **Runtime** talks to LibSQL directly (not through Caddy) via Docker DNS `libsql:8080`
- **Runtime** sends traces to Langfuse via Docker DNS `langfuse-web:3001` (joined to both networks)
- **Frontend** is static files baked into the Caddy container at build time (multi-stage Dockerfile). In dev mode (`docker-compose.override.yml`), replaced with Vite dev container.

**API Boundaries:**

| Boundary | Protocol | Owner | Consumers |
|----------|----------|-------|-----------|
| `/api/agents/:id/stream` | SSE (AI SDK) | Mastra (auto-generated) | Frontend `useChat` |
| `/api/workflows/:id/resume` | REST POST | Runtime `webhooks/linear.ts` | Cloudflare Tunnel (Linear webhook), Mock button |
| `/auth/*` | REST (Better Auth) | Runtime `auth/index.ts` | Frontend `use-auth.ts` |
| `/health` | REST GET | Runtime `index.ts` | Docker healthcheck |
| `/config.json` | Static file | Caddy | Frontend `config.ts` |
| LibSQL `:8080` | HTTP (sqld protocol) | LibSQL container | Runtime `db/client.ts`, Host `drizzle-kit studio` |

**Data Boundaries:**

| Data Domain | Tables | Owner (writes) | Readers |
|-------------|--------|----------------|---------|
| Auth | `user`, `session`, `account`, `verification` | Better Auth (via Drizzle) | Auth middleware, frontend (session) |
| Wiki | `wiki_documents`, `wiki_chunks` | Wiki generation pipeline (Koki) | Triage agent RAG queries |
| Workflow state | Mastra internal tables | Mastra runtime (auto-managed) | Workflow resume endpoint |
| Local tickets (fallback) | `local_tickets` | Triage workflow (when Linear unavailable) | Frontend kanban (fallback mode) |

### Agent Architecture

**Orchestrator → Workflow → Agent relationship:**
- Frontend `useChat` connects to `/api/agents/orchestrator/stream`
- Orchestrator agent invokes `triageWorkflow` as a Mastra workflow tool
- The workflow orchestrates steps; individual agents (Triage Agent, Resolution Reviewer) are called within workflow steps
- Triage Agent is NOT called directly by the Orchestrator — it runs as part of the workflow

### Requirements → Structure Mapping

**FR1-FR7 (Incident Intake):**
- `frontend/src/components/chat/chat-input.tsx` — text, paste, file upload
- `frontend/src/components/chat/file-preview.tsx` — thumbnails, validation
- `frontend/src/components/chat/message-list.tsx` — message rendering
- `runtime/src/mastra/agents/orchestrator.ts` — batch detection, routing

**FR8-FR12 (Codebase Intelligence):**
- `runtime/src/mastra/tools/wiki-generate.ts` — two-pass wiki generation tool (per-file → synthesis → embed)
- `runtime/src/mastra/workflows/wiki-generation-workflow.ts` — orchestrates repo connect → analysis → storage
- `runtime/src/mastra/tools/wiki-query.ts` — RAG query tool (used by triage agent)
- `runtime/src/db/schema.ts` — wiki_documents + wiki_chunks tables
- `runtime/src/lib/schemas/wiki.ts` — Zod schemas

**FR13-FR18 (Triage & Analysis):**
- `runtime/src/mastra/agents/triage-agent.ts` — core intelligence
- `runtime/src/lib/schemas/triage.ts` — TriageOutput schema

**FR19-FR27 (Ticket Management):**
- `runtime/src/mastra/tools/linear.ts` — create/read/update issues
- `runtime/src/lib/schemas/ticket.ts` — ticket creation schema
- `runtime/src/mastra/workflows/triage-workflow.ts` — dedup step, approval gate
- `frontend/src/components/ticket/ticket-card.tsx` — generative UI card
- `frontend/src/components/ticket/duplicate-prompt.tsx` — dedup UX
- `frontend/src/components/board/kanban-board.tsx` — Linear sync view

**FR28-FR31 (Notifications):**
- `runtime/src/mastra/tools/resend.ts` — email tools
- `runtime/src/mastra/workflows/triage-workflow.ts` — notify steps (non-blocking)

**FR32-FR37 (Resolution Verification):**
- `runtime/src/webhooks/linear.ts` — webhook handler
- `runtime/src/mastra/agents/resolution-reviewer.ts` — PR/commit verification
- `runtime/src/mastra/workflows/triage-workflow.ts` — suspend/resume, verify step

**FR38-FR42 (User & Project Management):**
- `runtime/src/auth/index.ts` — Better Auth
- `runtime/src/db/schema.ts` — user tables (Better Auth managed)
- `frontend/src/hooks/use-auth.ts` — client auth
- `frontend/src/routes/__root.tsx` — auth guard

**FR43-FR48 (Observability & Security):**
- `runtime/src/mastra/index.ts` — LangfuseExporter, security processors
- `Caddyfile` — security headers
- `docker-compose.yml` — healthcheck blocks

**FR49-FR52 (Error Handling & Resilience):**
- `runtime/src/mastra/workflows/triage-workflow.ts` — durable state, retry logic
- `frontend/src/components/chat/chat-input.tsx` — send disabled during triage
- `frontend/src/routes/chat.tsx` — error card rendering, file vs triage error distinction

### Data Flow

```
User types message + pastes image
    ↓
Frontend: chat-input.tsx validates files (size, type), resizes images (Canvas API)
    ↓
Frontend: useChat sends to /api/agents/orchestrator/stream (via Caddy proxy)
    ↓
Runtime: Mastra security processors (injection → PII → scrub)
    ↓
Runtime: Orchestrator agent detects single vs batch, invokes triageWorkflow as tool
    ↓
Runtime: triage-workflow step 1 — Triage Agent queries wiki (wiki-query tool → LibSQLVector)
    ↓
Runtime: triage-workflow step 2 — Triage Agent produces TriageOutput (Zod validated)
    ↓
Runtime: triage-workflow step 3 — Dedup check (linear tool → listIssues → semantic compare)
    ↓ (if duplicate found → ask user via chat, suspend for response)
Runtime: triage-workflow step 4 — displayTicket tool call → SSE to frontend (PREVIEW state)
    ↓
Frontend: ticket-card.tsx renders triage output in PREVIEW state with "Create Ticket" button
    ↓ (user reviews and approves)
Runtime: triage-workflow step 5 — Create Linear ticket (linear tool)
    ↓ (on success)
Frontend: ticket-card.tsx updates to CONFIRMED state — shows Linear link, confirmed badge
    ↓ (on failure → error card, no orphan ticket card)
Runtime: triage-workflow step 6 — Send email (resend tool, non-blocking)
    ↓
Runtime: triage-workflow step 7 — suspend() — wait for resolution
    ↓ ... time passes ...
Linear webhook → Cloudflare Tunnel → /api/webhooks/linear → workflow resume
    ↓
Runtime: triage-workflow step 8 — Resolution Reviewer checks PR/commits
    ↓
Runtime: triage-workflow step 9 — Send resolution email to reporter(s)
    ↓
DONE — full lifecycle traced in Langfuse with correlation ID
```

### Development Workflow

**Local Development:**
1. `cp .env.example .env` → fill API keys
2. `docker compose up --build` → dev mode (override auto-loads when `docker-compose.override.yml` exists)
   - Frontend: Vite dev server with HMR (replaces Caddy static serve)
   - Runtime: `tsx --watch` with `runtime/src` volume mount (auto-restart on changes)
   - Caddy: env var `CADDY_MODE=dev` switches to reverse-proxy Vite at `:5173` instead of serving static files
   - LibSQL, Langfuse stack: unchanged
3. Production mode (for demo recording): `docker compose -f docker-compose.yml up --build` (explicitly skip override)
4. Langfuse dashboard: `http://localhost:3001`
5. LibSQL inspection: `cd runtime && npx drizzle-kit studio` (connects via `localhost:8080`)

**Build Process:**
- Frontend: `npm run build` → Vite produces `dist/` → copied into Caddy container (multi-stage Dockerfile)
- Runtime: `npm run build` → TypeScript compiled → Node.js production image
- No monorepo tooling (no Turborepo, no Nx) — two independent `package.json` files

## Architecture Validation Results

### Coherence Validation ✅

**Decision Compatibility:** All technology choices verified compatible. Mastra v1.23 (Hono-based HTTP) + LibSQL (sqld) + Drizzle ORM + Better Auth + OpenRouter + Langfuse — no version conflicts. Single-origin Caddy proxy eliminates CORS and enables session cookies automatically.

**Pattern Consistency:** Naming conventions form a clean pipeline: snake_case (DB) → camelCase (TypeScript/JSON) → kebab-case (files). Error boundaries follow clear layer hierarchy (tools → workflows → API → frontend). Zod schemas split by domain prevent merge conflicts between developers.

**Structure Alignment:** Two-container architecture (runtime + frontend) maps cleanly to two package.json files, two Dockerfiles, and two init paths. Mastra owns the HTTP server; custom routes (auth, webhooks) register on it. No framework conflicts.

**Issue Found & Resolved:** Orchestrator → triageWorkflow invocation requires the workflow to be wrapped as a Mastra tool. Implementation note: create a workflow tool wrapper in `tools/` or define inline in orchestrator agent configuration.

### Requirements Coverage Validation ✅

**Functional Requirements:** All 52 FRs mapped to specific files in the project structure. Wiki generation pipeline (FR8-12) explicitly assigned to `wiki-generate.ts` tool + `wiki-generation-workflow.ts` workflow. No orphan requirements.

**Non-Functional Requirements:** All 37 NFRs addressed:
- Performance (7): Caddy SSE flush, lazy loading, Canvas API, pre-gen wiki, <60s triage
- Security (8): Mastra processors, Caddy headers (no Helmet.js), Better Auth cookies, DOMPurify, file validation
- Scalability (5): Docker Compose, 2-network topology, stateless/stateful separation, <2GB pull, named volumes
- Reliability (5): LibSQL persistence, auto-retry, graceful degradation, Zod validation, healthchecks
- Observability (4): LangfuseExporter, correlation IDs, token cost tracking, security event logging
- Integration (5): Linear SDK tools, webhook REST, Resend, OpenRouter config, mock fallbacks
- Documentation (3): All required files present in repo structure

### Hackathon Evaluation Criteria Cross-Reference

| Criterion | Key Architectural Evidence |
|-----------|--------------------------|
| **Reliability** | Mastra durable workflows (suspend/resume/persist to LibSQL), Zod schema validation, programmatic dedup, auto-retry, graceful degradation on all external services |
| **Observability** | LangfuseExporter, correlation ID propagation intake→resolution, token cost tracking, security event logging, all 9 containers with healthchecks |
| **Scalability** | 9-container Docker Compose (<1.6GB), 2-network topology, stateless runtime / stateful DB, LibSQL primary/replica path (SCALING.md), named volumes |
| **Context Engineering** | Two-pass llm-wiki (per-file → cross-module synthesis), LibSQL F32_BLOB(1536) + DiskANN, chunk-level RAG via vector_top_k(), text-embedding-3-small, confidence scoring |
| **Security** | Mastra processor pipeline (injection→PII→scrub) at 0.7 threshold, DOMPurify, Caddy security headers, Better Auth HttpOnly/SameSite=Lax cookies, file validation, no secrets in code |
| **Documentation** | README.md, AGENTS_USE.md (9 sections + evidence), SCALING.md, QUICKGUIDE.md, .env.example — all in repo structure |

### Architecture Completeness Checklist

**✅ Requirements Analysis**
- [x] 52 FRs analyzed and categorized
- [x] 37 NFRs mapped to architectural decisions
- [x] 5 user journeys reviewed
- [x] Cross-cutting concerns identified

**✅ Architectural Decisions**
- [x] All technology choices documented (locked)
- [x] Data architecture: embedding model, vector dims, migration strategy, wiki schema
- [x] Security: Caddy headers, processor pipeline order, session config
- [x] API: SSE streaming, Cloudflare Tunnel, error format, healthchecks
- [x] Frontend: state management, generative UI registry, lazy loading, two-phase ticket card
- [x] Infrastructure: 2 networks, named volume, HTTP dev / auto-HTTPS prod, Mastra as HTTP server, Caddyfile env var switching

**✅ Implementation Patterns**
- [x] Database/API/code/env var naming conventions
- [x] Structure: barrel files only in mastra subdirs, schemas split by domain
- [x] Error handling: tool-level boundaries, layer-specific patterns
- [x] 7 enforcement rules, 8 anti-patterns

**✅ Project Structure**
- [x] Complete repo tree with all files
- [x] Container boundaries with network diagram
- [x] API/data boundary tables
- [x] FR → file mapping for all 52 requirements
- [x] Data flow diagram with two-phase ticket card render
- [x] Dev workflow with override file (auto-loads as default)

### Architecture Readiness Assessment

**Overall Status:** READY FOR IMPLEMENTATION

**Confidence Level:** High — all decisions locked, all requirements mapped, all patterns defined, team assignments clear.

**Key Strengths:**
- Single-origin Caddy proxy eliminates CORS/cookie complexity
- Mastra as HTTP server (no Express) removes a framework layer
- Two-network Docker topology cleanly separates app from observability
- Tool-level error boundary pattern is simple and consistent
- Dev mode auto-loads via docker-compose.override.yml — correct default for hackathon
- Wiki generation has explicit home (tool + workflow)
- Two-phase ticket card render prevents orphan cards

**Areas for Future Enhancement (post-hackathon):**
- Formal ADRs (LibSQL over Postgres, Caddy over nginx, Canvas API over FFmpeg)
- Kubernetes deployment manifests (SCALING.md)
- Wiki refresh strategy (webhook on repo push)
- Rate limiting on LLM calls
- Production TLS (one-line Caddyfile change)

### Implementation Handoff

**First Implementation Priority (Day 1 morning, parallel):**
1. Fernando: `docker compose up --build` — all 9 containers, 2 networks, named volume, Caddyfile with env var switching, override file for dev mode
2. Lalo: `npm create mastra@latest` → configure OpenRouter → verify multimodal response
3. Koki: Frontend scaffold → `npx shadcn@latest init --template vite` → TanStack Router plugin
4. Chenko: Better Auth setup in runtime → drizzle-kit push → login flow

**Day 1 Smoke Tests (first 2 hours):**
1. All containers healthy
2. Mastra ↔ LibSQL connected
3. OpenRouter multimodal response (text + image)
4. Langfuse receiving traces
5. Better Auth login works
6. Linear API creates test issue
