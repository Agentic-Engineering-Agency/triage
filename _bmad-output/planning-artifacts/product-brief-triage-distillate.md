---
title: "Product Brief Distillate: Triage"
type: llm-distillate
source: "product-brief-triage.md"
created: "2026-04-07"
purpose: "Token-efficient context for downstream PRD creation"
---

# Product Brief Distillate: Triage

## Technical Context

- **Runtime:** Mastra v1.23 (agent orchestration built on Vercel AI SDK). Workflows with suspend/resume for human-in-the-loop. REST API for webhook-driven resume.
- **Database:** LibSQL (sqld) in Docker — 231 MB image, native F32_BLOB vector search with DiskANN. `@mastra/libsql` for both storage and vectors. No separate vector DB.
- **ORM:** Drizzle (`drizzle-orm/libsql` + `@libsql/client`). Required for Better Auth integration.
- **Auth:** Better Auth (self-hosted, embedded). Drizzle adapter with `provider: 'sqlite'`. Email/password. ~1-2h setup.
- **Observability:** Langfuse (self-hosted, ~1.05 GB Docker stack). Native `LangfuseExporter` in Mastra. OpenTelemetry traces across all agent actions.
- **LLM:** OpenRouter free tier (`@openrouter/ai-sdk-provider`). Current model: Qwen 3.6 Plus (multimodal). Fallbacks: OpenRouter free router, Groq, Gemini, paid OpenRouter.
- **Frontend:** TanStack (Router + Query) + AI SDK `useChat` connecting directly to Mastra agent endpoints. shadcn/ui components.
- **Generative UI:** AI SDK tool-based rendering (`message.parts` with tool states). json-render (`@json-render/react` + `@json-render/shadcn`) for dynamic layouts (stretch).
- **Email:** Resend (agenticengineering.lat domains).
- **Ticketing:** Linear first (`@linear/sdk` wrapped as Mastra tools + MCP). Jira/GitHub Issues as modular tool swaps.
- **Wiki:** llm-wiki approach — two-pass (per-file summaries → cross-file concept synthesis). Stored as text + F32_BLOB embeddings in LibSQL. Pre-generated for Solidus, auto-generated on project connect.
- **Docker:** 9 containers total. Frontend, Runtime, LibSQL, + Langfuse stack (web, worker, ClickHouse, Redis, MinIO, Postgres). Total ~1.6 GB pull.

## Agents Defined

- **Orchestrator:** Routes input, manages workflow, handles batch submissions (parallel branches per issue)
- **Triage Agent:** Queries codebase wiki (RAG), produces structured output: title, technicalSummary, proposedSolution, severity, priority, assignee, runbookSuggestion, confidenceScore. Asks clarifying questions in copilot mode.
- **Resolution Reviewer (Tier 2):** On ticket completion, checks PR/commits, verifies changes match original issue, triggers reporter notification or sends back for review. CodeRabbit-style (Tier 3 stretch).

## Requirements Hints (from brainstorming)

- Multimodal input: text + image paste (clipboard) + file upload (drag-and-drop) + video. Image paste is critical UX — not just file upload.
- Quick-upload mode (Tier 3): button that attaches file/stack trace and sends pre-configured prompt to skip conversation. Auto-triage with no back-and-forth.
- Confidence score on root cause analysis. Visible to users. Flag low-confidence explicitly.
- User management: import from Linear on project setup. Agent can add/manage users via chat. Store: name, email, linearId, slackId, notificationChannel.
- Per-project configuration: each project has own repo, wiki, skills, settings.
- Kanban board: one-way sync from Linear (read-only). Not a separate state — just a view.
- Deduplication: programmatic check in Mastra workflow (not LLM), before ticket creation. "Found similar issue — update or create new?"
- Severity scoring: structured output from LLM with consistent definitions (critical=system down, high=feature broken, medium=degraded, low=cosmetic).
- Runbook suggestions: included in ticket description by triage agent.
- Resolution flow: Linear webhook → Mastra resume → verify PR/commits → notify reporter. Handles both PR-based and direct-push workflows. No evidence → send back to review.
- Post-incident learning (Vision): pattern detection across past incidents, automatic postmortems.

## Rejected Ideas (with rationale)

- **Matrix for notifications:** Deprioritized — Slack is standard, Matrix requires Element client. Email is priority.
- **Postgres instead of LibSQL:** Team debated. LibSQL wins on size (231 MB vs 396 MB), simplicity, native vectors, and Mastra first-class support. Postgres extensions advantage not needed at this scale.
- **Supabase:** Too heavy (~12+ GB local Docker pull). Overkill for auth + DB.
- **Neon local:** Not truly local — cloud proxy requiring internet. Rejected.
- **Clerk for auth:** External dependency, sends user data to third party. Better Auth keeps everything local.
- **Nous Hermes self-improving skills:** Too complex for 48h, not visible in demo. Post-hackathon.
- **Auto-fixing code (agents writing PRs):** Out of scope — triage only, not resolution. Vision item.
- **Inngest for durable execution:** Mastra's suspend/resume + LibSQL persistence is sufficient. Add Inngest only if needed.
- **Full Kubernetes in demo:** Only document in SCALING.md. Docker Compose for the actual demo.

## Detailed User Scenarios

- **Non-technical reporter:** PM says "the checkout button doesn't work on mobile." Attaches screenshot. Triage agent queries Solidus wiki, identifies likely CSS/responsive issue in storefront, creates Linear ticket assigned to frontend dev, severity: medium.
- **Developer quick report:** Pastes stack trace showing ActiveRecord::RecordNotFound in Spree::OrdersController. Quick-upload mode auto-triages: identifies order lookup failure in solidus_core, references specific file/line, proposes solution (check order scope), creates ticket with confidence score 87%.
- **Batch submission:** Support lead reports 3 issues from customer calls. Types them all in one message. Orchestrator splits into parallel branches, triages each independently, creates 3 Linear tickets with separate assignees.
- **Duplicate detection:** User reports "payment page is slow." Triage detects existing ticket "Payment gateway timeout on Stripe integration" from yesterday. Asks: "Found similar issue — update it or create new?" User says update, agent adds new context to existing ticket.
- **Resolution verification:** Developer marks ticket complete. Triage checks: finds PR #247 merged, diff touches the files referenced in original triage. Confirms changes address the issue. Emails original reporter: "Your reported issue has been resolved. Here's what changed: [summary]."
- **Failed verification:** Ticket marked complete but no PR or commits found. Triage adds comment: "No code changes detected. Please link the PR or describe what was done." Moves ticket back to In Review.

## Scope Signals (MVP vs. Later)

- **MVP:** Chat intake, multimodal, Solidus wiki, Linear tickets, email notifications, dedup, severity scoring, resolution verification, Langfuse observability, security guardrails, Docker Compose
- **Soon after (Tier 3):** Quick-upload mode, Slack, Jira, GitHub Issues, Electron wrapper, on-call routing
- **Later (Vision):** Any codebase/language, post-incident learning, pattern detection, agents that create fix PRs, team intelligence dashboard, PagerDuty/Opsgenie integration

## Open Questions

- Exact latency budget for triage — acceptable range: seconds or minutes? (Likely 30-90 seconds based on LLM call + RAG query)
- Rate limiting / cost caps on LLM calls when multiple incidents come in simultaneously
- How to handle stale codebase wiki — periodic refresh? Webhook on repo push?
- Demo video: show second repo connection (30 extra seconds) to prove generalizability? (Team says yes if not too hard)

## Competitive Intelligence

- **PagerDuty / Opsgenie:** Alert routing, not triage intelligence. No codebase understanding.
- **Jira/Linear AI features:** Auto-categorization but no codebase analysis. No root cause identification.
- **CodeRabbit / Sourcery:** Code review, not incident triage. Adjacent but different workflow.
- **Sentry / Datadog:** Error detection and monitoring, not incident intake from humans. Could be upstream data source for Triage.
- **No direct competitor** does: multimodal intake → codebase-aware triage → ticket creation → resolution verification in one tool.

## Team & Timeline

- **Team:** Lalo (workflows/agents), Lucy (infra/platform), Coqui (runtime/integrations), Chenko (frontend)
- **Timeline:** April 7 2PM → April 9 9PM COT (~55h, 4 people, AI-assisted dev)
- **Hackathon:** AgentX 2026 by SoftServe. $10K prizes. Judged on: Reliability, Observability, Scalability, Context Engineering, Security, Documentation.
