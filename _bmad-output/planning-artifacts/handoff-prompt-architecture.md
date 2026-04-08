# Handoff Prompt: Architecture Generation

Use the BMAD architecture skill (`/bmad-create-architecture`). The PRD and all planning artifacts contain everything you need.

## Primary Input

**PRD:** `_bmad-output/planning-artifacts/prd.md` — Read this FIRST. It contains 52 functional requirements, 37 non-functional requirements, 5 user journeys, web app specific requirements (with party mode refinements from 4 BMAD agents), and detailed scoping with owner assignments.

## Supporting Context

- **Product Brief Distillate:** `_bmad-output/planning-artifacts/product-brief-triage-distillate.md` — Token-efficient technical context summary
- **Tech Stack Final:** `HACKATHON_BRAINSTORM_OUTPUT/11-tech-stack-final.md` — Complete tech stack with Docker architecture, integration map, fallback options
- **Research Findings:** `HACKATHON_BRAINSTORM_OUTPUT/12-research-findings.md` — Mastra workflows, Langfuse, Better Auth, LibSQL, AI SDK generative UI research
- **Linear Tasks:** `HACKATHON_BRAINSTORM_OUTPUT/13-linear-tasks.md` — Task breakdown with dependencies and critical path
- **SRE Agent Brainstorm:** `HACKATHON_BRAINSTORM_OUTPUT/08-session2-sre-agent.md` — Agent architecture, workflow patterns, resolution flow details
- **Team Assignments:** `HACKATHON_BRAINSTORM_OUTPUT/09-team-assignments-v2.md` — Who builds what, Day 1/2 timeline, dependency graph

## What Triage Is

AI-powered SRE incident triage agent for e-commerce (Solidus/Rails). Users describe incidents in chat (text + images), the agent queries a codebase wiki (llm-wiki RAG), identifies root cause with file references, creates a Linear ticket, notifies via email, and verifies resolution when the fix ships. Built for AgentX Hackathon 2026 (4 people, 48 hours).

## Key Decisions Already Made (DO NOT re-debate)

These were decided after extensive brainstorming, research, and team review. The architecture should formalize them, not question them:

| Component | Decision | Rationale |
|-----------|----------|-----------|
| **Orchestration** | Mastra v1.23 + Vercel AI SDK | Built on AI SDK, first-class workflows with suspend/resume |
| **Database** | LibSQL (sqld) in Docker | 231MB, native F32_BLOB vectors + DiskANN, `@mastra/libsql` for storage + vectors |
| **ORM** | Drizzle (`drizzle-orm/libsql`) | Required for Better Auth integration |
| **Auth** | Better Auth (self-hosted, embedded) | Drizzle adapter with `provider: 'sqlite'`, email/password |
| **Observability** | Langfuse (self-hosted) | Native `LangfuseExporter` in Mastra, ~1.05GB Docker stack |
| **LLM** | OpenRouter (Mercury paid / Qwen 3.6+ free) | `@openrouter/ai-sdk-provider`, multimodal, images only for MVP |
| **Frontend** | TanStack Router + Query + AI SDK `useChat` | SPA, shadcn/ui, 2 routes: `/chat`, `/board` |
| **Static Serve** | Caddy with Caddyfile | Serves SPA + reverse-proxies `/api/*` and `/auth/*` to runtime. Single-origin eliminates CORS. `flush_interval -1` for SSE. |
| **Email** | Resend | agenticengineering.lat domains |
| **Ticketing** | Linear (`@linear/sdk` as Mastra tools + MCP) | First integration, mock fallback to local LibSQL |
| **Wiki/RAG** | llm-wiki two-pass → LibSQL F32_BLOB vectors | Per-file summaries → cross-module synthesis |
| **Security** | Mastra processors (prompt injection, PII, system prompt scrub) + DOMPurify | Evidence screenshots required for AGENTS_USE.md |
| **Containers** | 9 total: Frontend(Caddy), Runtime(Mastra), LibSQL, + Langfuse stack (web, worker, ClickHouse, Redis, MinIO, Postgres) | ~1.6GB total pull |
| **Image resize** | Canvas API (zero dependencies) | NOT FFmpeg.wasm |

## Architecture Focus Areas

The PRD's Web App Requirements section (refined by party mode with Winston/Architect, Sally/UX, Amelia/Dev, Quinn/QA) already contains significant architectural decisions. The architecture document should:

1. **Formalize the container architecture** — Docker Compose service definitions, networking, health checks, volume mounts
2. **Define the Mastra workflow** — Step-by-step: intake → triage → dedup → ticket → notify → suspend → [webhook resume] → verify → notify reporter. Include error handling at each step.
3. **Define the agent contracts** — Orchestrator, Triage Agent, Resolution Reviewer. Input/output schemas (Zod), tools available to each, system prompts.
4. **Data model** — LibSQL tables: users (Better Auth), wiki docs + vectors, workflow state, local tickets (fallback). Drizzle schema.
5. **API design** — Mastra agent endpoints, Better Auth routes, webhook endpoints, health checks
6. **Codebase wiki pipeline** — Two-pass llm-wiki: how files are selected, chunked, summarized, synthesized, embedded, and queried
7. **ADRs** — Formalize key decisions: LibSQL over Postgres, Caddy over nginx, single-origin proxy, Canvas API over FFmpeg, card-renders-after-ticket-confirmed, send-disabled-during-triage
8. **Security architecture** — Mastra processor pipeline order, DOMPurify placement, Caddy security headers, Better Auth cookie config
9. **Observability architecture** — Langfuse exporter config, correlation ID propagation, what gets traced at each workflow step

## Constraints

- **Timeline:** 4 developers start building tomorrow morning (April 8). Architecture must be actionable, not theoretical.
- **Hackathon eval criteria:** Reliability, Observability, Scalability, Context Engineering, Security, Documentation — architecture must address all 6.
- **Team:** Lalo (workflows/agents), Lucy (infra/platform), Coqui (runtime/integrations), Chenko (frontend). Architecture should enable parallel development across all 4 from Day 1.
- **No over-engineering:** This is a 48-hour build. The architecture should be the simplest thing that works and hits all eval criteria. No Kubernetes (Docker Compose only, document K8s path in SCALING.md). No microservices (monolithic runtime). No message queues (Mastra workflows handle orchestration).
