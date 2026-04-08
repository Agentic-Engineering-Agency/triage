# Handoff Prompt: PRD Creation for Triage

> Use this prompt to start a new BMAD session for PRD creation. Copy-paste this entire prompt to the new agent.

---

## Context

You are creating a **Product Requirements Document (PRD)** for **Triage** — an AI-powered SRE Incident Intake & Triage Agent being built for the **AgentX Hackathon 2026** by SoftServe.

**Timeline:** The build sprint is April 8-9, 2026 (2 days). Submission deadline: April 9, 9 PM COT. The PRD needs to be actionable for 4 developers (Lalo, Lucy, Coqui, Chenko) building with AI coding tools.

**Hackathon evaluation criteria** (these must be explicitly addressed in the PRD):
1. Reliability
2. Observability
3. Scalability
4. Context Engineering
5. Security
6. Documentation

## Input Documents

Read ALL of the following files thoroughly before starting. They contain the complete brainstorming output, decisions, research, and product brief:

### Product Brief (PRIMARY INPUT)
- `_bmad-output/planning-artifacts/product-brief-triage.md` — The executive product brief with pitch narrative, requirements map, and AGENTS_USE.md section mapping
- `_bmad-output/planning-artifacts/product-brief-triage-distillate.md` — Detail pack with rejected ideas, detailed user scenarios, competitive intelligence, technical constraints, scope signals, and open questions

### Hackathon Rules & Assignment
- `HACKATHON_CONTEXT/assignment.md` — The exact hackathon assignment (SRE agent core flow)
- `HACKATHON_CONTEXT/deliverables.md` — Required deliverables (README, AGENTS_USE.md, SCALING.md, QUICKGUIDE.md, docker-compose.yml, .env.example, MIT license, 3-min YouTube demo)
- `HACKATHON_CONTEXT/technical_requirements.md` — Docker Compose mandatory, acceptable mocked integrations, demo video requirements
- `HACKATHON_CONTEXT/official_rules.md` — Rules, timeline, evaluation process, prizes
- `HACKATHON_CONTEXT/AGENTS_USE.md` — Template for AGENTS_USE.md (9 sections, sections 6 and 7 require evidence)

### Brainstorming Output
- `HACKATHON_BRAINSTORM_OUTPUT/08-session2-sre-agent.md` — Complete Session 2 brainstorm with all architectural decisions
- `HACKATHON_BRAINSTORM_OUTPUT/09-team-assignments-v2.md` — Team task assignments with Day 1/Day 2 timeline and dependencies
- `HACKATHON_BRAINSTORM_OUTPUT/11-tech-stack-final.md` — Final tech stack with every package, container, and fallback option
- `HACKATHON_BRAINSTORM_OUTPUT/12-research-findings.md` — Research on Mastra workflows, Langfuse, Better Auth, LibSQL, Vercel AI SDK, llm-wiki
- `HACKATHON_BRAINSTORM_OUTPUT/13-linear-tasks.md` — 31 Linear tasks across 5 epics with dependencies and acceptance criteria
- `HACKATHON_BRAINSTORM_OUTPUT/10-risk-matrix.md` — 10 risks with team-assessed likelihood and mitigations
- `HACKATHON_BRAINSTORM_OUTPUT/01-hackathon-details.md` — Hackathon summary
- `HACKATHON_BRAINSTORM_OUTPUT/02-original-vision.md` — Session 1 broader "Agentic Engineer" vision (long-term context)

## Key Decisions Already Made (DO NOT re-debate)

- **Database:** LibSQL (sqld) with native F32_BLOB vectors. NOT Postgres.
- **Auth:** Better Auth via Drizzle ORM. NOT Clerk, NOT Supabase.
- **Orchestration:** Mastra v1.23 with Vercel AI SDK.
- **Observability:** Langfuse (self-hosted) with native Mastra LangfuseExporter.
- **LLM:** OpenRouter free tier (Qwen 3.6 Plus multimodal).
- **Frontend:** TanStack + AI SDK `useChat` + json-render (shadcn).
- **Ticketing:** Linear first via `@linear/sdk`.
- **Email:** Resend.
- **Target codebase:** Solidus (Ruby on Rails).
- **Docker Compose:** 9 containers (Frontend, Runtime, LibSQL, Langfuse stack x6).

## What the PRD Should Cover

1. **Functional requirements** mapped to the E2E flow: intake → triage → dedup → ticket → notify → suspend → resolve → verify → notify reporter
2. **Non-functional requirements** explicitly mapped to the 6 evaluation criteria
3. **Agent specifications** for each agent (Orchestrator, Triage Agent, Resolution Reviewer) including inputs, outputs, tools, and structured output schemas (Zod)
4. **Mastra workflow definition** with steps, branching, suspend/resume points, error handling
5. **API contracts** between frontend ↔ runtime ↔ database ↔ external services
6. **UI/UX requirements** for chat page, kanban page, auth pages, generative UI cards
7. **Security requirements** with specific Mastra processors and configurations
8. **Observability requirements** with specific trace spans, correlation IDs, what to capture for AGENTS_USE.md evidence
9. **Docker architecture** with container specs, env vars, health checks, networking
10. **Acceptance criteria** for each feature tier (Tier 1, 2, 3)
11. **Demo video script** with second-by-second breakdown

## Instructions

Use the BMAD PRD creation skill (`/bmad-create-prd`). The product brief and distillate contain everything you need — the brainstorming sessions have extensive technical detail. Focus the PRD on being **actionable for the 4 developers starting tomorrow morning**. Every requirement should be implementable, testable, and mappable to a Linear task.

The PRD should be written so that any of the 4 team members can read their section and start building immediately without needing to ask clarifying questions. This is a hackathon — there's no time for ambiguity.
