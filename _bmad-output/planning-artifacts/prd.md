---
stepsCompleted: ['step-01-init', 'step-01b-continue', 'step-02-discovery', 'step-02b-vision', 'step-02c-executive-summary', 'step-03-success', 'step-04-journeys', 'step-05-domain', 'step-06-innovation', 'step-07-project-type', 'step-08-scoping', 'step-09-functional', 'step-10-nonfunctional', 'step-11-polish', 'step-12-complete']
classification:
  projectType: web_app
  domain: devops_sre
  complexity: medium-high
  projectContext: greenfield
inputDocuments:
  - _bmad-output/planning-artifacts/product-brief-triage.md
  - _bmad-output/planning-artifacts/product-brief-triage-distillate.md
  - _bmad-output/brainstorming/brainstorming-session-2026-04-07-01.md
  - _bmad-output/planning-artifacts/handoff-prompt-prd.md
  - HACKATHON_CONTEXT/assignment.md
  - HACKATHON_CONTEXT/deliverables.md
  - HACKATHON_CONTEXT/technical_requirements.md
  - HACKATHON_CONTEXT/official_rules.md
  - HACKATHON_CONTEXT/AGENTS_USE.md
  - HACKATHON_CONTEXT/resources_for_hackathon.md
  - HACKATHON_BRAINSTORM_OUTPUT/08-session2-sre-agent.md
  - HACKATHON_BRAINSTORM_OUTPUT/09-team-assignments-v2.md
  - HACKATHON_BRAINSTORM_OUTPUT/10-risk-matrix.md
  - HACKATHON_BRAINSTORM_OUTPUT/11-tech-stack-final.md
  - HACKATHON_BRAINSTORM_OUTPUT/12-research-findings.md
  - HACKATHON_BRAINSTORM_OUTPUT/13-linear-tasks.md
  - HACKATHON_BRAINSTORM_OUTPUT/01-hackathon-details.md
  - HACKATHON_BRAINSTORM_OUTPUT/02-original-vision.md
documentCounts:
  briefs: 2
  research: 1
  brainstorming: 1
  hackathonContext: 6
  brainstormOutput: 8
  projectDocs: 0
workflowType: 'prd'
---

# Product Requirements Document - Triage

**Author:** Fr
**Date:** 2026-04-07

## Executive Summary

Engineering teams spend 15-25% of their time on incident triage — not fixing bugs, but figuring out what's broken, where in the codebase it lives, and who should handle it. A product manager reports "the checkout is broken." A developer stops what they're building, spends 30-60 minutes grepping through the repo, reconstructs the probable cause, manually creates a ticket, assigns it, and pings the team. Resolution verification is nonexistent: tickets get marked "done" with no check that the fix actually shipped.

**Triage** is an AI-powered SRE agent that automates the entire incident lifecycle — from intake to verified resolution. Users describe incidents in natural language through a chat interface, attaching screenshots, log files, or video. Triage's agent analyzes a pre-generated knowledge base of the connected codebase (starting with Solidus, a Ruby on Rails e-commerce platform), identifies the likely root cause down to specific files and functions, scores severity, assigns the right engineer, creates a fully detailed ticket in Linear, and notifies the team via email. When the fix ships, Triage verifies the associated PR/commits against the original issue and notifies the reporter. The full intake-to-resolution loop — automated, observable, and secure.

Built for the AgentX Hackathon 2026 (April 8-9, 4-person team, 48-hour sprint), Triage targets all six evaluation criteria: Reliability (Mastra durable workflows with suspend/resume), Observability (end-to-end Langfuse traces), Scalability (9-container Docker Compose, Kubernetes-ready), Context Engineering (llm-wiki codebase RAG), Security (prompt injection detection, PII redaction), and Documentation (README, AGENTS_USE.md with evidence, SCALING.md, QUICKGUIDE.md). The architecture is modular — each integration (Linear, Resend, OpenRouter) is a tool swap, not a rewrite — positioning Triage for post-hackathon extension to any codebase, any ticketing system, any notification channel.

### What Makes This Special

**Codebase intelligence is the moat.** Every incident management tool on the market — PagerDuty, Jira AI features, Sentry — operates on text and metadata. None of them understand the actual codebase. Triage generates a living knowledge base using a two-pass llm-wiki approach (per-file summaries, then cross-module synthesis), stores it as vector embeddings in LibSQL, and queries it via RAG for every incident. This is the difference between "ticket filed" and "root cause identified with file references and a proposed fix at 87% confidence."

**Resolution verification closes the loop.** No other triage tool checks whether the fix actually shipped. Triage's resolution flow verifies PRs/commits against the original issue and only marks an incident resolved when code changes are confirmed. No evidence of a fix → ticket goes back to review.

**Copilot UX, not another form.** Incident reporting through conversation is fundamentally lower-friction than filling out fields. The agent extracts structure from unstructured input — users describe problems in their words, Triage handles the translation to technical artifacts.

**No competitive overlap.** PagerDuty routes alerts. Jira tracks tickets. Sentry catches errors. CodeRabbit reviews PRs. None do multimodal intake → codebase-aware triage → ticket creation → resolution verification in one tool.

## Project Classification

- **Project Type:** Web application (SPA) — TanStack Router + AI SDK `useChat` frontend, Mastra agent orchestration backend, LibSQL database with native vector search
- **Domain:** DevOps / SRE — incident management and triage automation for engineering teams (5-50 developers)
- **Complexity:** Medium-High — multi-agent AI orchestration, durable workflows with suspend/resume, codebase RAG via llm-wiki, multimodal LLM input, external integrations (Linear, Resend, OpenRouter), 9-container Docker architecture
- **Project Context:** Greenfield — built from scratch for AgentX Hackathon 2026. 4 developers (Lalo, Lucy, Coqui, Chenko), ~55 hours, AI-assisted development

## Success Criteria

### User Success

- **Non-technical reporters** can describe an incident in their own words (text + screenshot) and receive a fully triaged, assigned ticket within 60 seconds — no technical vocabulary required
- **Engineers** receive tickets with root cause analysis citing specific files/functions, a proposed fix, and severity scoring — eliminating the 30-60 minute context-switching tax of manual triage
- **Engineering managers** gain visibility into incident patterns, resolution times, and team workload through the Kanban view and Langfuse observability dashboard
- **Original reporters** receive a resolution notification confirming the fix shipped — the loop is closed without them having to follow up

### Business Success

**Hackathon (April 8-9):**
- Complete E2E flow demonstrated: submit → triage → ticket → notify → resolve → verify → notify reporter
- All 6 evaluation criteria addressed with concrete evidence (especially Observability and Security with screenshots in AGENTS_USE.md sections 6 and 7)
- Clean `docker compose up --build` from scratch, comprehensive documentation (README, AGENTS_USE, SCALING, QUICKGUIDE)
- 3-minute YouTube demo covers full flow with production-readiness proof points

**Product (6-month horizon):**
- Triage accuracy: >80% of auto-assigned tickets reach the correct engineer on first assignment
- Time-to-triage: <2 minutes from report to fully detailed ticket (vs. 30-60 minutes manual)
- Resolution verification: >90% of "completed" tickets have verified code changes before reporter notification
- Adoption: 3+ engineering teams actively using Triage for daily incident management

### Technical Success

- **Reliability:** Mastra durable workflows survive container restarts (suspend → restart → resume). Deduplication is programmatic, not LLM-guessed. Structured output via Zod schemas ensures consistent ticket format.
- **Observability:** Every agent action traced end-to-end in Langfuse with correlation IDs from intake to resolution. Token costs tracked per triage. Trace timelines visible in dashboard.
- **Scalability:** 9-container Docker Compose architecture with documented Kubernetes scaling path. LibSQL supports primary/replica replication. Stateless runtime scales independently from stateful DB.
- **Context Engineering:** Codebase wiki generated via two-pass llm-wiki, stored as F32_BLOB vectors in LibSQL, queried via RAG for every incident. Confidence scoring flags low-certainty results.
- **Security:** Prompt injection blocked before reaching agent. PII redacted from LLM context and logs. System prompt scrubbed from outputs. All secrets via environment variables only.
- **Documentation:** All required files present and complete. AGENTS_USE.md sections 6 and 7 contain evidence screenshots.

### Measurable Outcomes

| Metric | Target | Measurement |
|--------|--------|-------------|
| Incident-to-ticket time | <60 seconds | Langfuse trace duration (intake → ticket created) |
| Root cause accuracy | >80% correct file/module identification | Manual review of first 50 triages against Solidus codebase |
| Assignment accuracy | >80% correct engineer on first assignment | Track reassignment rate in Linear |
| Resolution verification rate | >90% of "done" tickets have verified code changes | Workflow completion logs |
| Duplicate detection | >70% of true duplicates caught before ticket creation | Compare created tickets against known duplicate pairs |
| Confidence calibration | Confidence score correlates with accuracy | Plot confidence vs. correctness across triages |

## User Journeys

### Journey 1: Maria the PM — "The Checkout Is Broken" (Primary Reporter, Happy Path)

Maria is a product manager at an e-commerce company running Solidus. It's Tuesday at 2 PM. A customer support ticket just came in: checkout fails on mobile when paying with PayPal. Maria doesn't know if it's frontend, backend, or the payment gateway. She just knows it's broken and customers are leaving.

**Before Triage:** Maria would ping the engineering Slack channel with "checkout broken on mobile + PayPal, help?" — then wait 20 minutes for someone to respond, answer 5 clarifying questions she can't fully answer, and hope the right person picks it up. Total time from report to someone actually investigating: 45-90 minutes.

**With Triage:** Maria opens the chat interface. Types: "Customers are getting a 500 error on checkout when using PayPal on mobile." Pastes a screenshot from the support ticket showing the error page. Triage's agent asks one clarifying question: "Is this happening for all payment methods or only PayPal?" Maria answers "Only PayPal." Within 30 seconds, the agent has queried the Solidus wiki, identified `solidus_core/app/models/spree/payment.rb` as the likely root cause (PayPal gateway timeout in the payment processing flow), proposed a fix (add retry logic with exponential backoff), scored severity as **High** (feature broken for a payment method), and assigned it to Diego — the engineer who last touched the payments module.

A Linear ticket appears in chat as a rich card: title, technical summary, confidence score (87%), severity badge, assigned engineer. Maria doesn't need to understand the technical details — they're there for Diego. Simultaneously, Diego receives an email with the full triage.

Two hours later, Diego pushes a fix. He marks the ticket complete in Linear. Triage checks PR #247, confirms the diff touches the files from the original triage, and emails Maria: "Your reported issue has been resolved. Changes: added PayPal gateway retry logic with 3-attempt backoff in payment processing. PR #247 merged."

Maria never had to follow up. The loop closed itself.

### Journey 2: Carlos the Developer — Stack Trace Quick Drop (Primary User, Edge Case)

Carlos is a backend engineer. His monitoring just caught an `ActiveRecord::RecordNotFound` in `Spree::OrdersController#show`. He doesn't need a conversation — he already knows what happened, he just needs it tracked and triaged properly.

Carlos opens Triage, pastes the full stack trace into chat, and hits send. No back-and-forth. The agent recognizes this as a developer-submitted incident, skips clarifying questions, and goes straight to analysis. It queries the Solidus wiki, identifies the order lookup failure in `solidus_core/app/controllers/spree/orders_controller.rb`, cross-references with the order scoping logic, and proposes: "Check order scope — user-visible orders may exclude incomplete orders that the controller is trying to display."

Confidence: 91%. Severity: Medium (degraded experience, not system-down). Auto-assigned to Carlos himself since he's the one who reported it and has backend expertise. Linear ticket created. Carlos clicks through to Linear and starts fixing.

**Reveals:** The system must handle both conversational (Maria) and direct-submission (Carlos) input styles. Developer-submitted incidents with stack traces should minimize unnecessary back-and-forth.

### Journey 3: Sofia the Support Lead — Batch Incident Submission

Sofia manages the customer support team. After the Monday morning support queue review, she has three separate customer issues to escalate to engineering:

1. "Search results are slow on the catalog page"
2. "Tax calculation is wrong for orders shipping to Colombia"
3. "Product images aren't loading on the category page"

Sofia opens Triage and types all three in a single message. The orchestrator agent recognizes this as a batch submission, splits into three parallel triage branches, and processes each independently. Within 90 seconds, three Linear tickets appear in chat — each with its own triage analysis, severity, and assignee. The search issue goes to the backend team (Medium severity), the tax calculation goes to the orders specialist (High severity — financial impact), and the image loading goes to the frontend team (Medium severity).

Three emails go out to three different engineers. Sofia's done. What used to take her 30 minutes of separate ticket filing with incomplete technical details is now handled in under 2 minutes with full root cause analysis on each.

**Reveals:** Batch processing requires parallel workflow execution. The orchestrator must detect multi-issue submissions and split them without user intervention.

### Journey 4: Diego the Engineer — Duplicate Detection and Resolution Verification

Diego receives Maria's PayPal checkout ticket from Journey 1. But before he starts, another PM reports: "payment page is crashing for international orders." Triage detects semantic similarity with Maria's existing ticket (PayPal gateway timeout) and prompts the second reporter: "Found similar issue: 'PayPal gateway 500 error on mobile checkout' — would you like to update the existing ticket with this new context, or create a separate issue?" The reporter chooses to update. Diego now has one enriched ticket instead of two duplicates.

Diego fixes the issue, creates PR #247, and marks the ticket Done in Linear. The Linear webhook triggers Triage's resolution flow: the workflow resumes, checks for associated PRs, finds PR #247, analyzes the diff against the original triage. The changes touch `spree/payment.rb` — confirmed match. Triage emails both Maria and the second reporter with a resolution summary.

**But what if Diego marks it done without a PR?** Triage checks for code changes and finds nothing. It adds a comment to the Linear ticket: "No code changes detected for this issue. Please link the relevant PR or describe what was done." The ticket moves back to In Review. The loop doesn't close until there's evidence.

**Reveals:** Deduplication must happen before ticket creation (programmatic check). Resolution verification must handle both PR-based and direct-push workflows. Failed verification must gracefully push back.

### Journey 5: Lucy the Platform Admin — Project Setup and Wiki Generation

Lucy is setting up Triage for a new codebase. She logs in with her Better Auth credentials, navigates to project settings, and connects the Solidus GitHub repository. Triage immediately begins the wiki generation process: two-pass analysis (per-file summaries, then cross-module synthesis) with a progress indicator showing which modules are being analyzed.

While the wiki generates (~2-3 minutes for Solidus core), Lucy imports team members from Linear. The system pulls names, emails, and roles. Lucy fills in missing details via chat: "Diego specializes in payments and backend. Carlos handles the order pipeline. Fernanda does frontend and catalog."

Wiki generation completes. Lucy can now see the codebase knowledge base — structured summaries of payment flows, order state machines, inventory management, API endpoints. Triage is ready to accept incidents for this project.

**Reveals:** Project setup requires repo connection, wiki generation with progress feedback, team member import, and expertise mapping. This is a one-time setup per project, not a per-incident flow.

### Journey Requirements Summary

| Journey | Key Capabilities Revealed |
|---------|--------------------------|
| Maria (PM Reporter) | Chat-based multimodal input, copilot-style clarifying questions, structured triage output, auto-assignment by expertise, email notifications, resolution verification with reporter notification |
| Carlos (Developer) | Direct stack trace submission, minimal-conversation mode, self-assignment awareness, developer-optimized triage output |
| Sofia (Batch) | Multi-issue detection, parallel triage workflows, independent assignment per issue, batch notification |
| Diego (Dedup + Resolution) | Semantic duplicate detection, ticket enrichment, resolution verification (PR/commit check), failed verification recovery, multi-reporter notification |
| Lucy (Admin Setup) | Repo connection, wiki generation with progress, Linear user import, expertise mapping, project configuration |

## Innovation & Novel Patterns

### Detected Innovation Areas

**1. Codebase-Aware Incident Triage (Primary Innovation)**
No existing incident management tool bridges the gap between human-reported symptoms and codebase-level root cause analysis. Triage combines a llm-wiki knowledge base (two-pass: per-file summaries → cross-module synthesis) with RAG-based querying to produce root cause analysis that cites specific files, functions, and code paths. This is fundamentally different from text classification or keyword routing — it's semantic understanding of an entire codebase applied to incident intelligence.

**2. Automated Resolution Verification (Novel Pattern)**
The incident management loop today is open-ended: someone marks a ticket "done" and everyone hopes it's true. Triage's resolution flow programmatically verifies that code changes (PRs/commits) match the original triage before notifying the reporter. This is a novel closed-loop pattern — no competitor implements it.

**3. Conversational Multimodal Intake → Structured Technical Output**
The translation from "the checkout is broken" + a screenshot to a fully structured ticket with root cause analysis, confidence scoring, severity classification, and auto-assignment is a novel AI agent pipeline. Existing tools either accept structured input (forms) or produce unstructured output (chat). Triage does unstructured-in, structured-out with codebase grounding.

**4. Durable Agent Workflows with Human-in-the-Loop Suspension**
Using Mastra's suspend/resume pattern to create workflows that pause mid-execution (waiting for ticket resolution via webhook), persist state to LibSQL, survive container restarts, and resume exactly where they left off. This is a production-grade pattern that most hackathon projects skip.

### Market Context & Competitive Landscape

| Tool | What It Does | What It Doesn't Do |
|------|-------------|-------------------|
| PagerDuty / Opsgenie | Alert routing and escalation | No codebase understanding, no intake from humans |
| Jira / Linear AI features | Auto-categorization, summaries | No root cause analysis, no codebase awareness |
| Sentry / Datadog | Error detection and monitoring | Not incident intake — upstream data source, not triage |
| CodeRabbit / Sourcery | Code review automation | Different workflow — reviews PRs, not incidents |

**Gap:** No tool does multimodal intake → codebase-aware triage → ticket creation → resolution verification in one integrated pipeline. Triage occupies this gap.

### Validation Approach

- **Hackathon demo (immediate):** Live E2E flow against Solidus codebase — submit incident, show root cause analysis with file references, verify ticket quality, demonstrate resolution verification
- **Connect second repo (30 seconds):** Prove generalizability by connecting a non-Solidus codebase during demo, showing wiki generation works on any repo
- **Confidence calibration:** Track whether confidence scores correlate with actual accuracy across demo triages
- **Judge criteria mapping:** Every innovation maps to at least one of the 6 evaluation criteria (see Hackathon Requirements Map in product brief)

### Risk Mitigation

| Innovation Risk | Mitigation |
|----------------|------------|
| Wiki generation too slow for demo | Pre-generate Solidus wiki before recording. Scope to `solidus_core` if needed. |
| Root cause accuracy too low | Confidence scoring makes uncertainty explicit. Low-confidence triages flag themselves rather than hallucinating file references. |
| RAG retrieval misses relevant context | Fallback: agent can search wiki with broader queries. Wiki quality directly impacts triage quality — invest in two-pass generation. |
| Resolution verification too rigid | Handle both PR-based and direct-push workflows. "No evidence" triggers graceful push-back, not hard failure. |
| Free LLM tier unreliable | OpenRouter has internal fallback routing. Multiple backup providers configured (Groq, Gemini, paid OpenRouter). One env var change to switch. |

## Web Application Specific Requirements

### Project-Type Overview

Triage is a **single-page application (SPA)** with two primary routes (`/chat` for incident intake, `/board` for Kanban view). It's an auth-gated internal tool for engineering teams — not a public-facing website. The frontend connects to a Mastra agent backend via AI SDK `useChat` for real-time streaming chat, and uses TanStack Query for data fetching (Linear sync for Kanban).

### Technical Architecture Considerations

**SPA Architecture:**
- TanStack Router with 2 routes: `/chat` (primary), `/board` (Kanban)
- AI SDK `useChat` hook → Mastra agent endpoint (HTTP streaming via SSE)
- AI SDK `experimental_attachments` for multimodal file uploads (files → base64 encoding → attachment in request body)
- TanStack Query for non-chat data fetching (Linear issues, user profiles)
- shadcn/ui component library for consistent, accessible UI primitives
- Auth-gated: Better Auth client SDK, redirect to login if unauthenticated
- Lazy route loading: TanStack Router `lazy()` for `/board` route — trivial one-line change, reduces initial bundle from ~300KB to ~180-200KB gzipped. `/board` loads on-demand (~100-120KB, ~200ms first navigation)

**Single-Origin Architecture via Caddy (Critical):**
Caddy serves as the single entry point for the browser — serving static files AND reverse-proxying API requests to the runtime container. This eliminates all CORS configuration and ensures Better Auth session cookies attach automatically (`SameSite=Lax` works because the browser only talks to one origin). No cross-origin issues for SSE streaming.

**Caddyfile Reference:**
- `try_files {path} /index.html` — SPA client-side routing (prevents 404s on page refresh)
- `reverse_proxy /api/* runtime:3000` — API requests to Mastra runtime
- `flush_interval -1` on API reverse proxy — prevents SSE response buffering (critical for chat streaming)
- `reverse_proxy /auth/* runtime:3000` — Better Auth endpoints
- Gzip/zstd compression for static assets
- HSTS and security headers (investigate whether Caddy can fully replace Helmet.js on the runtime — if so, consolidate security headers in Caddyfile)

**Real-Time Requirements:**
- Chat messages stream in real-time via AI SDK SSE (Server-Sent Events)
- Generative UI: tool-based rendering via `message.parts` — ticket cards render only when the tool call completes (full card at once). Progressive rendering with loading skeletons is a stretch goal.
- Kanban board: periodic refresh via TanStack Query (not WebSocket — one-way Linear sync)

**Browser Support:**
- Modern evergreen browsers (Chrome, Firefox, Safari, Edge — latest 2 versions)
- No IE11 support required (internal engineering tool)
- Desktop-first layout with basic responsiveness via shadcn/ui
- Clipboard paste must be tested on Chrome + Safari minimum (behavior varies)

**SEO:** Not applicable — auth-gated internal tool, no public pages to index.

**Accessibility:** Baseline via shadcn/ui (Radix UI primitives provide keyboard navigation, ARIA attributes, focus management). Not a primary optimization target for hackathon, but the component library provides a solid foundation.

### Multimodal Input Architecture

This is the most complex frontend capability and a hackathon requirement:

- **Text input** with send button (standard chat)
- **Image paste** from clipboard — critical UX for bug screenshots. Handle `paste` event, extract image blob, display as removable thumbnail in composer area (not sent immediately). Multiple images allowed per message.
- **File upload** via file picker button (attachments icon). Accepted types: images (.png, .jpg, .gif), log files (.log, .txt), video (.mp4, .webm)
- **Drag-and-drop zone** — Tier 3 stretch goal. Priority is paste + attachments button. If implemented: entire message area becomes drop zone with visual overlay ("Drop files here") on drag-over.
- **File preview** — removable thumbnails for images, filename + size badge for other types. Clear visual affordance that message has attachments.
- **File size limits** — 10MB per file, 25MB total per message. Reject oversized files with clear error in composer (before send attempt).
- **Client-side image resize** — auto-downscale images to max 1024px using Canvas API (zero dependencies, built into all browsers). No FFmpeg.wasm — overkill for image resize.
- **File type validation** — reject unsupported types with clear error in composer
- **Multimodal LLM** — OpenRouter (Mercury for paid/demo, Qwen 3.6 Plus for free tier). Images only for MVP — no video processing. Video frame extraction via Gemini 3.1 Flash is a stretch goal.

### Generative UI (Ticket Cards)

AI SDK tool-based rendering for structured triage output displayed in chat:

- Define `displayTicket` tool with Zod schema
- LLM calls tool → client renders `TicketCard` component via `message.parts` (`tool-invocation` part with `state: 'result'`). Map tool name to component: `displayTicket` → `<TicketCard />`
- **Card does NOT render until Linear ticket is confirmed created.** If Linear API fails, show error state instead of a card with no backing ticket.
- Card shows: title, severity badge (color-coded), priority, assignee, technical summary (click to expand/collapse), proposed solution (collapsed by default), confidence score, direct link to Linear issue
- **Approve/Create flow:** Triage card renders with a "Create Ticket" button. User reviews the triage output and confirms before the ticket is sent to Linear. Severity/priority edits are done via chat ("change severity to critical"), not by editing the card directly.
- Card is **read-only in MVP** — no inline editing of fields
- Error state: card renders in error style (red border) with error details. Detailed errors logged to console.
- Stretch goal: progressive rendering with loading skeleton during tool execution
- Stretch: `@json-render/react` + `@json-render/shadcn` for LLM-composed multi-card layouts

### Chat UX States

- **Loading (triage in progress):** Chat shows a loading/thinking indicator while agent processes. Send button is **disabled** during active triage to prevent concurrent submissions and accidental duplicates.
- **Error (triage failed):** Discard partial response, show retry indicator, attempt one automatic retry after 2-3 second delay. If retry fails, show error card with "Triage failed — try again" button. Log partial response to console for debugging.
- **File upload error vs. triage error:** Separate states. File errors (too large, wrong type) show immediately in composer and block send. Triage errors appear in the chat stream after upload succeeded.
- **Empty state:** Standard chat welcome message with usage guidance.

### Performance Targets

| Metric | Target | Measurement Method |
|--------|--------|--------------------|
| Chat message send → first token | <2 seconds | Langfuse trace: timestamp of first SSE chunk arrival. Free tier adds latency; paid (Mercury) significantly faster. |
| Full triage (report → ticket card) | <60 seconds | Langfuse trace duration (intake → ticket confirmed created) |
| Wiki generation (Solidus core) | <3 minutes | Two-pass analysis, pre-generate for demo |
| Kanban board load | <2 seconds | TanStack Query fetch from Linear API |
| Page load (initial, /chat) | <2 seconds | ~180-200KB gzipped with lazy /board route |
| Image paste → preview | <200ms | Client-side only, no server round-trip |
| Image resize (Canvas API) | <100ms | Client-side Canvas API, sub-100ms for 1024px downscale |

### Health Checks

All custom containers expose health check endpoints for Docker Compose `healthcheck` blocks:

- **Caddy (frontend):** built-in health check
- **Runtime (Mastra):** `/health` endpoint that verifies LibSQL connectivity
- **LibSQL (sqld):** native `/health` endpoint
- **Langfuse stack:** already has health checks in official compose

Judges will see `healthy` status on all containers — production-readiness signal.

### Graceful Degradation for External Services

The demo must never depend on a third-party being up at the exact moment of recording. Real integrations by default, mock fallbacks as safety net:

| Service | Default | Fallback |
|---------|---------|----------|
| OpenRouter (LLM) | Mercury (paid) or Qwen 3.6+ (free) | OpenRouter free router auto-fallback, Groq, Gemini |
| Resend (email) | Real email delivery | Log to console + "email would be sent" in UI. Email failure must NOT block triage workflow. |
| Linear (tickets) | Real Linear API via `@linear/sdk` | If `LINEAR_API_KEY` is empty, create local ticket in LibSQL and display in UI. Judges can evaluate the flow without a Linear workspace. |

### LLM Model Strategy

- **Default (free):** OpenRouter free tier — Qwen 3.6 Plus (multimodal, images)
- **Demo/paid:** Mercury via OpenRouter — fastest inference, comparable to Sonnet 3.5 level, very cheap. Images only (no video).
- **Video processing (stretch):** Gemini 3.1 Flash via OpenRouter — extract frames from video, pass as context. Extremely cheap.
- **Bring your own key:** Stretch goal — dashboard config to set custom OpenRouter/OpenAI API key. OpenRouter API is compatible with OpenAI format.

### Implementation Considerations

**Docker Containerization:**
- Frontend container: Node.js build → static serve via Caddy (Caddyfile configuration). Caddy also reverse-proxies API + auth to runtime.
- Separate from runtime container (Mastra + agents)
- Environment variables: prefer runtime config injection via Caddy `templates` directive or `/config.json` served by Caddy (SPA fetches on boot). Avoids rebuild when API URLs change between environments.
- Dockerfile optimized for layer caching (dependencies → build → serve)

**State Management:**
- Chat state: AI SDK `useChat` manages message history, streaming state, tool results
- Auth state: Better Auth client SDK (session cookies — work automatically via single-origin Caddy proxy)
- Server state: TanStack Query for Linear data, user profiles
- No client-side global state store needed (no Redux/Zustand)

**Sections Skipped** (per project-type configuration): native device features, CLI commands

## Project Scoping & Phased Development

### MVP Strategy & Philosophy

**MVP Approach:** Problem-Solving MVP — demonstrate that AI-powered codebase-aware triage works end-to-end. The hackathon judges evaluate *execution quality and production-readiness*, not feature count. A polished E2E flow that hits all 6 criteria beats a sprawling feature set with rough edges.

**Core Constraint:** 4 developers, ~55 hours, April 8 (2PM) → April 9 (9PM COT). AI-assisted development multiplies effective capacity to ~140-160 person-hours, but integration testing and documentation consume the final 6-8 hours.

**MVP Validation Question:** Can a non-technical person describe an incident in chat, and within 60 seconds have a fully detailed Linear ticket created with root cause analysis citing specific Solidus files — and later receive a resolution notification when the fix ships?

If the answer is yes with evidence (Langfuse traces, security screenshots, Docker Compose running), we win.

### MVP Feature Set (Phase 1 — Must Ship)

**Core User Journeys Supported:**
- Journey 1 (Maria): Non-technical reporter → chat → triage → ticket → notify → resolve → notify reporter
- Journey 4 (Diego): Duplicate detection + resolution verification
- Journey 5 (Lucy): Project setup + wiki generation (pre-generated for demo)

**Must-Have Capabilities (Tier 1 — ~30-40h across 4 people):**

| Capability | Owner | Est. | Eval Criteria Hit |
|-----------|-------|------|-------------------|
| Docker Compose (all 9 containers) | Lucy | 3-4h | Scalability, Documentation |
| Mastra Runtime + first agent | Coqui | 3-4h | Reliability |
| Chat UI (multimodal: text + image paste + file upload) | Chenko | 6-8h | Reliability |
| Linear Integration (`@linear/sdk` + MCP) | Coqui | 3-4h | Reliability |
| Email Notification (Resend) | Lucy | 2-3h | Reliability |
| Better Auth (login/register) | Lucy | 2-3h | Security |
| Mastra Workflow (full E2E: intake → triage → ticket → notify → suspend → resolve → notify) | Lalo | 4-5h | Reliability |
| Triage Agent (RAG + analysis + structured output) | Lalo | 6-8h | Context Engineering |

**Tier 2 — Should Ship (Differentiators, ~24-32h):**

| Capability | Owner | Est. | Eval Criteria Hit |
|-----------|-------|------|-------------------|
| Codebase Wiki Generation (llm-wiki for Solidus) | Coqui | 5-6h | Context Engineering |
| Langfuse Observability (traces across all stages) | Lucy | 3-4h | Observability |
| Generative UI Ticket Cards | Chenko | 3-4h | Reliability |
| Resolution Flow (webhook → verify → notify) | Lalo | 3-4h | Reliability |
| Prompt Injection Guardrails | Coqui | 2-3h | Security |
| Kanban View (one-way Linear sync) | Lucy + Chenko | 3-4h | Reliability |
| Severity Scoring + Deduplication | Lalo | 1h | Reliability |
| Import Users from Linear | Coqui | 1-2h | Reliability |

### Post-MVP Features

**Phase 2 — Tier 3 Stretch (if time allows during hackathon):**
- Quick-upload auto-triage mode (button skips conversation)
- Slack notifications
- Jira / GitHub Issues integrations (modular tool swaps)
- Electron/Tauri desktop wrapper
- json-render full layout composition
- Resolution Reviewer (CodeRabbit-style PR analysis)
- Drag-and-drop file zone (full drop zone overlay)
- Progressive ticket card rendering (skeleton → full)
- Bring your own API key (dashboard config)

**Phase 3 — Vision (post-hackathon):**
- Any codebase, any language
- Incident pattern recognition + automatic postmortems
- Agents that create fix PRs
- Team intelligence dashboard
- On-call routing intelligence
- PagerDuty/Opsgenie as upstream data sources
- Self-improving agent skills

### Risk Mitigation Strategy

**Technical Risks:**

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Better Auth + Drizzle + LibSQL edge cases | Medium | **Medium** | Implement Day 1 morning first. If breaks, hardcode user for demo. Auth not a judging criterion. |
| Mastra workflow state loss on restart | Medium | Low | State persists to LibSQL. Test suspend → restart → resume cycle early. |
| OpenRouter free tier rate-limited | Critical | Very Low | Fallback routing built in. Pay for Mercury credits (~$1-2 for full demo). |
| Demo video exceeds 3 minutes | Medium | **Medium** | Script with allocated seconds per section. Practice twice. Speed up video if needed. |

**External Service Risks:**
- OpenRouter down → automatic fallback model routing + Mercury paid tier
- Resend down → console log + "email would be sent" UI indicator (email failure never blocks triage)
- Linear down → local ticket creation in LibSQL (mock mode when `LINEAR_API_KEY` is empty)

**Day 1 Smoke Tests (first 2 hours, before any features):**
1. `docker compose up --build` — all containers healthy
2. Mastra connects to LibSQL, creates tables
3. OpenRouter responds with multimodal input (text + image)
4. Langfuse receives traces from Mastra
5. Better Auth login works via Drizzle + LibSQL
6. Linear API creates an issue via `@linear/sdk`

If any fail, fix in hour 1 — not hour 40.

**Critical Path:** INFRA-01 (Docker) → RUNTIME-01 (Mastra) → INTEG-01 (Linear) → AGENT-01 (Workflow) → AGENT-02 (Triage) → AGENT-03 (Resolution)
**Parallel Path:** INFRA-01 → INFRA-02 (Auth) → FE-01 (Chat UI) → FE-02 (Cards)

## Functional Requirements

### Incident Intake

- **FR1:** Reporters can submit incident reports via a chat-based conversational interface using natural language
- **FR2:** Reporters can attach images to incident reports by pasting from clipboard
- **FR3:** Reporters can attach files (images, log/text files) to incident reports via a file picker. Video file support is a stretch goal.
- **FR4:** The system can process multimodal input (text + images) and use both modalities for triage analysis
- **FR5:** The triage agent can ask clarifying questions when incident description is ambiguous or insufficient
- **FR6:** Reporters can submit multiple incidents in a single message, and the system processes each independently in parallel
- **FR7:** The system can detect whether input is a conversational description or a direct technical artifact (stack trace) and adjust interaction style accordingly

### Codebase Intelligence

- **FR8:** Administrators can connect a public GitHub repository to a project for codebase analysis (direct pull). For private repositories, administrators can upload a ZIP archive of the codebase for analysis. GitHub authentication is not required for MVP.
- **FR9:** The system can generate a structured knowledge base (wiki) from a connected codebase using two-pass analysis (per-file summaries, then cross-module synthesis)
- **FR10:** The system can display wiki generation progress to the administrator during analysis
- **FR11:** The triage agent can query the codebase knowledge base to identify relevant files, functions, and code paths for a given incident
- **FR12:** The system can store and retrieve codebase knowledge as vector embeddings for semantic search

### Triage & Analysis

- **FR13:** The triage agent can produce a structured triage output containing: title, technical summary, root cause analysis with file/function references, proposed solution, severity, priority, and recommended assignee
- **FR14:** The triage agent can assign a confidence score to its root cause analysis and explicitly flag low-confidence results
- **FR15:** The triage agent can classify incident severity using consistent definitions (critical = system down, high = feature broken, medium = degraded, low = cosmetic)
- **FR16:** The triage agent can classify incident priority (urgent, high, medium, low)
- **FR17:** The triage agent can recommend an assignee based on team member expertise areas
- **FR18:** The triage agent can include runbook suggestions in the triage output

### Ticket Management

- **FR19:** The system can create fully populated tickets in Linear with all triage output fields (title, description, severity label, priority, assignee)
- **FR20:** The system can check for semantically similar existing tickets before creating a new one (deduplication)
- **FR21:** When a duplicate is detected, reporters can choose to update the existing ticket or create a new one
- **FR22:** Reporters can review the triage output and approve ticket creation before it is sent to Linear
- **FR23:** The system can display created tickets as structured cards in the chat interface showing key triage fields
- **FR24:** Users can expand and collapse technical details within ticket cards
- **FR25:** Ticket cards can link directly to the corresponding Linear issue
- **FR26:** The system can display tickets in a Kanban board view synchronized one-way from Linear (read-only)
- **FR27:** When `LINEAR_API_KEY` is not configured, the system can create and display tickets locally as a fallback

### Notifications

- **FR28:** The system can send email notifications to assigned team members when a ticket is created, including full triage details
- **FR29:** The system can send email notifications to the original reporter when their incident is resolved, including a resolution summary
- **FR30:** When multiple reporters are associated with a ticket (via deduplication), all reporters receive resolution notifications
- **FR31:** Email notification failures do not block the triage workflow

### Resolution Verification

- **FR32:** The system can detect when a ticket is marked as resolved in Linear (via webhook)
- **FR33:** The system can resume a suspended workflow when a resolution webhook is received
- **FR34:** The resolution agent can check for associated PRs or commits related to a resolved ticket
- **FR35:** The resolution agent can verify that code changes in PRs/commits are relevant to the original incident
- **FR36:** When no code change evidence is found, the system can move the ticket back to review and request clarification
- **FR37:** When changes are verified, the system can compose a resolution summary describing what was fixed

### User & Project Management

- **FR38:** Users can register and authenticate via email and password
- **FR39:** Unauthenticated users are redirected to the login page
- **FR40:** Administrators can import team members from Linear (name, email, role)
- **FR41:** Administrators can define team member expertise areas (e.g., payments, frontend, orders) via chat
- **FR42:** Each project can have its own connected repository, wiki, and team configuration

### Observability & Security

- **FR43:** The system can trace every agent action end-to-end (from intake to resolution) with correlation IDs
- **FR44:** The system can track and display token costs per triage
- **FR45:** The system can detect and block prompt injection attempts before they reach the agent
- **FR46:** The system can redact PII (emails, API keys) from input before it reaches the LLM
- **FR47:** The system can scrub system prompt content from agent outputs
- **FR48:** All containers can report health status for Docker Compose health checks

### Error Handling & Resilience

- **FR49:** The system can persist workflow state and resume after container restarts (durable execution)
- **FR50:** The system can retry a failed triage once (with delay) and show an error state if retry also fails
- **FR51:** The system can prevent concurrent triage submissions from the same user (send disabled during active triage)
- **FR52:** The system can distinguish between file upload errors and triage processing errors, surfacing each appropriately

## Non-Functional Requirements

### Performance

- **NFR1:** Chat message submission to first streamed token SHALL complete within 2 seconds (paid LLM tier) or 5 seconds (free tier)
- **NFR2:** Full triage cycle (report submission to ticket card display) SHALL complete within 60 seconds for single-incident reports
- **NFR3:** Codebase wiki generation SHALL complete within 5 minutes for repositories up to 50,000 lines of code
- **NFR4:** Kanban board data refresh SHALL complete within 2 seconds
- **NFR5:** Initial page load (chat route) SHALL complete within 2 seconds on a standard broadband connection (~180-200KB gzipped bundle)
- **NFR6:** Client-side image resize (Canvas API) SHALL complete within 100ms for images up to 4096px
- **NFR7:** Deduplication check (semantic similarity against existing tickets) SHALL complete within 3 seconds

### Security

- **NFR8:** All user input SHALL pass through a prompt injection detector before reaching the LLM agent. Detected injections SHALL be blocked and logged.
- **NFR9:** PII (email addresses, API keys, credentials) in incident reports SHALL be redacted before reaching the LLM context
- **NFR10:** System prompt content SHALL be scrubbed from all agent outputs before display to users
- **NFR11:** All API secrets (OpenRouter, Linear, Resend, Better Auth) SHALL be stored exclusively in environment variables, never in code or LLM context
- **NFR12:** User sessions SHALL be managed via Better Auth with secure cookie configuration (HttpOnly, SameSite=Lax, Secure in production)
- **NFR13:** All user-submitted HTML content SHALL be sanitized via DOMPurify before rendering
- **NFR14:** HTTP security headers SHALL be applied to all responses (via Caddy and/or Helmet.js)
- **NFR15:** File uploads SHALL be validated for type and size (max 10MB/file, 25MB/message) before processing

### Scalability

- **NFR16:** The entire application SHALL run via a single `docker compose up --build` command with no host-level dependencies beyond Docker Compose
- **NFR17:** The architecture SHALL separate stateless (frontend, runtime) from stateful (database) containers to enable independent scaling
- **NFR18:** LibSQL SHALL support primary/replica replication for read scaling (documented in SCALING.md, not implemented for MVP)
- **NFR19:** The Langfuse observability stack SHALL scale independently from the application stack
- **NFR20:** Total Docker image pull size SHALL not exceed 2GB for the complete stack (currently ~1.6GB)

### Reliability

- **NFR21:** Mastra workflow state SHALL persist to LibSQL, enabling workflow resumption after container restarts
- **NFR22:** The triage workflow SHALL NOT fail permanently due to a single transient LLM API error — one automatic retry with 2-3 second delay before surfacing error to user
- **NFR23:** External service failures (Resend, Linear) SHALL NOT block the core triage workflow. Graceful degradation with fallback behavior SHALL be provided.
- **NFR24:** All 9 Docker containers SHALL expose health check endpoints and report `healthy` status in Docker Compose
- **NFR25:** Structured triage output SHALL be validated against Zod schemas to ensure consistent format regardless of LLM response variance

### Observability

- **NFR26:** Every agent action (tool calls, LLM inferences, workflow steps) SHALL be traced end-to-end in Langfuse with correlation IDs from intake to resolution
- **NFR27:** Token usage and cost SHALL be tracked per triage and visible in the Langfuse dashboard
- **NFR28:** Trace timelines SHALL be visible in the Langfuse UI showing the full span tree for each incident lifecycle
- **NFR29:** Security events (prompt injection attempts, PII redactions) SHALL be logged with sufficient detail for AGENTS_USE.md Section 7 evidence

### Integration

- **NFR30:** Linear integration SHALL use `@linear/sdk` wrapped as Mastra tools, supporting create, read, and update operations on issues
- **NFR31:** Linear webhook events SHALL be receivable at a REST endpoint for workflow resume triggers
- **NFR32:** Email integration SHALL use Resend API with templates for ticket assignment and resolution notification
- **NFR33:** LLM provider SHALL be configurable via environment variable, supporting OpenRouter (default), with model selection configurable independently
- **NFR34:** All external integrations SHALL have a mock/fallback mode for demo resilience (console log for email, local DB for tickets, fallback model for LLM)

### Documentation

- **NFR35:** Repository SHALL include: README.md, AGENTS_USE.md (9 sections with evidence screenshots), SCALING.md, QUICKGUIDE.md, docker-compose.yml, .env.example, LICENSE (MIT)
- **NFR36:** AGENTS_USE.md Sections 6 (Observability) and 7 (Security) SHALL contain actual screenshots/logs as evidence, not descriptions
- **NFR37:** QUICKGUIDE.md SHALL enable a new developer to run the application from clone to running in under 5 minutes (clone → copy .env.example → fill keys → docker compose up)
