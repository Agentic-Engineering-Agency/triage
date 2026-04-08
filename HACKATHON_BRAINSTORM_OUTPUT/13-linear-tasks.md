# Linear Tasks — SRE Incident Triage Agent

> Import these into Linear as issues. Each task has: title, assignee, priority, labels, estimate, description, and dependencies.
> Priority: Urgent (Tier 1), High (Tier 2), Medium (Tier 3), Low (Tier 4/Docs)

---

## EPIC: Infrastructure & Platform (Lucy)

### TASK: INFRA-01 — Docker Compose Setup
- **Assignee:** Lucy
- **Priority:** Urgent
- **Labels:** infrastructure, tier-1
- **Estimate:** 3-4h
- **Description:** Create `docker-compose.yml` with all containers:
  - Frontend (TanStack build, custom Dockerfile)
  - Runtime (Mastra + Node.js, custom Dockerfile)
  - Database (LibSQL `ghcr.io/tursodatabase/libsql-server:latest-arm`)
  - Langfuse stack (web, worker, ClickHouse, Redis, MinIO, Postgres — copy from Langfuse official compose)
  - Health checks on all containers
  - `.env.example` with all required variables
  - Verify `docker compose up --build` works from clean state
- **Dependencies:** None (Day 1 first task)
- **Acceptance:** All containers start and are healthy. Team can clone and run.

### TASK: INFRA-02 — Better Auth Setup
- **Assignee:** Lucy
- **Collaborator:** Chenko (frontend auth pages)
- **Priority:** Urgent
- **Labels:** infrastructure, auth, tier-1
- **Estimate:** 2-3h
- **Description:** Implement Better Auth with:
  - Drizzle ORM + `@libsql/client` connecting to LibSQL container
  - `provider: 'sqlite'` in Drizzle adapter
  - Email/password authentication
  - Session management (cookies)
  - Run `npx auth@latest migrate` for schema
  - `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` in `.env.example`
  - Test: register, login, session persistence
- **Dependencies:** INFRA-01 (LibSQL container running)
- **Acceptance:** User can register and login. Sessions persist across page refresh.

### TASK: INFRA-03 — Email Notifications (Resend)
- **Assignee:** Lucy
- **Priority:** Urgent
- **Labels:** infrastructure, notifications, tier-1
- **Estimate:** 2-3h
- **Description:** Implement email notifications via Resend:
  - Mastra tool wrapping Resend API
  - Email templates: new ticket assigned, ticket resolved
  - Use agenticengineering.lat domain
  - `RESEND_API_KEY` in `.env.example`
  - Test: send real email on ticket creation
- **Dependencies:** INFRA-01
- **Acceptance:** Team member receives email when assigned a ticket. Reporter receives email on resolution.

### TASK: INFRA-04 — Langfuse Observability Configuration
- **Assignee:** Lucy
- **Collaborator:** Lalo
- **Priority:** High
- **Labels:** infrastructure, observability, tier-2
- **Estimate:** 3-4h
- **Description:** Configure Mastra → Langfuse integration:
  - `LangfuseExporter` in Mastra config
  - Verify traces appear for: agent runs, tool calls, workflow steps
  - Correlation IDs across the full flow (intake → triage → ticket → notify)
  - **Capture evidence screenshots** for AGENTS_USE.md Section 6
  - Verify Langfuse dashboard shows trace timelines
- **Dependencies:** INFRA-01, RUNTIME-01
- **Acceptance:** Full E2E flow visible as connected traces in Langfuse. Screenshots captured.

### TASK: INFRA-05 — Kanban View (Linear Sync)
- **Assignee:** Lucy
- **Collaborator:** Chenko
- **Priority:** High
- **Labels:** frontend, tier-2
- **Estimate:** 3-4h
- **Description:** Kanban board page showing Linear issues:
  - One-way sync from Linear (read-only)
  - Columns: Backlog, Todo, In Progress, Done
  - Issue cards with title, priority, assignee, severity
  - Auto-refresh / real-time updates
  - TanStack Query for data fetching
- **Dependencies:** INTEG-01 (Linear tools), FE-01 (TanStack app)
- **Acceptance:** Kanban board shows real Linear issues. Updates when issues change in Linear.

---

## EPIC: Runtime & Integrations (Coqui)

### TASK: RUNTIME-01 — Mastra Runtime Setup
- **Assignee:** Coqui
- **Collaborator:** Lalo
- **Priority:** Urgent
- **Labels:** runtime, tier-1
- **Estimate:** 3-4h
- **Description:** Initialize Mastra project:
  - `@mastra/core` + `@mastra/libsql` for storage + vectors
  - Connect to LibSQL container (`http://libsql:8080`)
  - `@openrouter/ai-sdk-provider` for LLM (Qwen 3.6 Plus)
  - Verify: agent responds to text, agent responds to text+image (multimodal)
  - First agent endpoint accessible from frontend
  - Dockerfile for runtime container
- **Dependencies:** INFRA-01 (LibSQL container)
- **Acceptance:** Mastra agent responds to multimodal input. Traces visible (once Langfuse configured).

### TASK: INTEG-01 — Linear Integration
- **Assignee:** Coqui
- **Priority:** Urgent
- **Labels:** integration, tier-1
- **Estimate:** 3-4h
- **Description:** Linear ticketing integration:
  - `@linear/sdk` wrapped as Mastra tools: createIssue, updateIssue, getIssue, listIssues, getTeamMembers
  - MCP integration for broader Linear access
  - Structured output: title, description (with technical summary + runbook), priority, assignee, severity label
  - `LINEAR_API_KEY` in `.env.example`
  - Test: create real issue in Linear from agent
- **Dependencies:** RUNTIME-01
- **Acceptance:** Agent can create, read, and update Linear issues via tools.

### TASK: CONTEXT-01 — Codebase Wiki Generation (llm-wiki)
- **Assignee:** Coqui
- **Priority:** High
- **Labels:** context-engineering, tier-2
- **Estimate:** 5-6h
- **Description:** Implement llm-wiki approach for Solidus:
  - Pass 1: Per-file summaries of key Solidus modules (core, backend, api)
  - Pass 2: Cross-file concept synthesis (payment flow, order state machine, inventory, etc.)
  - Store wiki docs in LibSQL as text + F32_BLOB embeddings via `LibSQLVector`
  - RAG query function: given an incident description, retrieve relevant wiki sections
  - Scope to `solidus_core` initially (expand if time allows)
  - Pre-generate wiki and cache results for demo
- **Dependencies:** RUNTIME-01
- **Acceptance:** Triage agent can query wiki and get relevant Solidus code context for any incident.

### TASK: SEC-01 — Prompt Injection Guardrails
- **Assignee:** Coqui
- **Priority:** High
- **Labels:** security, tier-2
- **Estimate:** 2-3h
- **Description:** Configure Mastra security processors:
  - `prompt-injection-detector` (block strategy, threshold 0.7)
  - `system-prompt-scrubber` (filter strategy)
  - `pii-detector` (redact strategy for emails, API keys in incident reports)
  - DOMPurify for HTML sanitization on user inputs
  - **Capture evidence screenshots/logs** for AGENTS_USE.md Section 7
  - Test: submit prompt injection attempt, verify it's blocked
- **Dependencies:** RUNTIME-01
- **Acceptance:** Prompt injection attempts are blocked. PII is redacted. Evidence captured.

### TASK: INTEG-02 — Import Users from Linear
- **Assignee:** Coqui
- **Priority:** High
- **Labels:** integration, tier-2
- **Estimate:** 1-2h
- **Description:** On project setup, import team members from Linear:
  - Pull users from Linear API (name, email, role)
  - Map to internal user data type (name, email, linearId, slackId, notificationChannel)
  - Store in LibSQL via Better Auth user extension or separate table
  - Agent can fill missing details via chat conversation
- **Dependencies:** INTEG-01, INFRA-02
- **Acceptance:** Users imported from Linear. Agent knows who to assign tickets to.

### TASK: INTEG-03 — Slack Integration
- **Assignee:** Coqui
- **Priority:** High
- **Labels:** integration, notifications, tier-2
- **Estimate:** 2-3h
- **Description:** Slack notification channel:
  - Mastra tool wrapping Slack Webhook API
  - Notify on: new ticket created, ticket resolved
  - `SLACK_WEBHOOK_URL` in `.env.example`
  - Test: receive Slack message on ticket creation
- **Dependencies:** RUNTIME-01
- **Acceptance:** Slack message appears when ticket is created or resolved.

---

## EPIC: Agent Logic & Workflows (Lalo)

### TASK: AGENT-01 — Mastra Workflow (Core E2E Flow)
- **Assignee:** Lalo
- **Collaborator:** Coqui (tools)
- **Priority:** Urgent
- **Labels:** agent, workflow, tier-1
- **Estimate:** 4-5h
- **Description:** Implement the core Mastra workflow:
  ```
  intake → triage → dedup check → create ticket → notify team
    → suspend() → [webhook resume] → verify changes → notify reporter
  ```
  - Sequential steps with `.then()`
  - Deduplication as programmatic check (not LLM) before ticket creation
  - `suspend()` at "wait for resolution" step
  - Resume endpoint: `POST /api/workflows/:id/resume`
  - Error handling: retry on transient failures, log permanent failures
  - Batch support: `.parallel()` for multiple issues from one submission
- **Dependencies:** RUNTIME-01, INTEG-01
- **Acceptance:** Full E2E flow works: submit → triage → ticket → email → wait → resolve → notify reporter.

### TASK: AGENT-02 — Triage Agent
- **Assignee:** Lalo
- **Priority:** Urgent
- **Labels:** agent, tier-1
- **Estimate:** 6-8h
- **Description:** The core intelligence agent:
  - Receives incident description (text + optional image/logs)
  - Queries Solidus wiki (RAG via LibSQLVector) for relevant code context
  - Produces structured output (Zod schema):
    - `title`: concise issue title
    - `technicalSummary`: root cause analysis with file/line references
    - `proposedSolution`: recommended fix approach
    - `severity`: critical/high/medium/low
    - `priority`: urgent/high/medium/low
    - `assignee`: best team member based on expertise area
    - `runbookSuggestion`: steps to investigate/resolve
  - If insufficient info, asks clarifying questions via chat (copilot-style)
  - System prompt with Solidus domain knowledge
- **Dependencies:** RUNTIME-01, CONTEXT-01 (wiki)
- **Acceptance:** Agent produces accurate triage with Solidus code references. Assigns correctly.

### TASK: AGENT-03 — Resolution Flow
- **Assignee:** Lalo
- **Priority:** High
- **Labels:** agent, workflow, tier-2
- **Estimate:** 3-4h
- **Description:** When ticket marked resolved in Linear:
  - Linear webhook → resume endpoint
  - Agent checks: PR exists? Commits reference the issue? Code changes relevant?
  - If no evidence of changes → update ticket status back to "In Review", comment asking what changed
  - If verified → compose resolution summary → email original reporter
  - Handle both PR-based and direct-push workflows
- **Dependencies:** AGENT-01, INTEG-01
- **Acceptance:** Reporter gets email with resolution summary. Missing evidence triggers re-review.

### TASK: AGENT-04 — Severity Scoring
- **Assignee:** Lalo
- **Priority:** High
- **Labels:** agent, tier-2
- **Estimate:** 0.5h
- **Description:** Structured output for severity via Zod schema. Already part of AGENT-02's output. Ensure it's:
  - Consistent (critical = system down, high = feature broken, medium = degraded, low = cosmetic)
  - Displayed in UI ticket cards
  - Used for notification urgency (critical → immediate email, low → batch digest)
- **Dependencies:** AGENT-02
- **Acceptance:** Every ticket has a severity label. Critical tickets send immediate notifications.

### TASK: AGENT-05 — Deduplication Check
- **Assignee:** Lalo
- **Priority:** High
- **Labels:** agent, workflow, tier-2
- **Estimate:** 0.5h
- **Description:** Before creating a new ticket, check for duplicates:
  - Query recent Linear issues via API
  - Semantic similarity check against new issue description
  - If similar issue found: ask user "Found similar issue [TITLE]. Update it or create new?"
  - Programmatic step in workflow, not pure LLM decision
- **Dependencies:** AGENT-01, INTEG-01
- **Acceptance:** Duplicate issues detected and user prompted before creation.

---

## EPIC: Frontend (Chenko)

### TASK: FE-01 — TanStack App Scaffold + Chat UI
- **Assignee:** Chenko
- **Priority:** Urgent
- **Labels:** frontend, tier-1
- **Estimate:** 6-8h
- **Description:** Full chat interface:
  - TanStack Router (2 routes: `/chat`, `/board`)
  - AI SDK `useChat` hook → Mastra agent endpoint
  - Message rendering with `message.parts` (text + tool results)
  - **Multimodal input:**
    - Text input with send button
    - Image paste (clipboard) — critical UX
    - File upload (drag-and-drop + button): images, logs, video
    - File type validation + preview
  - Responsive layout, shadcn/ui components
  - Auth-gated (redirect to login if not authenticated)
  - Dockerfile for frontend container
- **Dependencies:** INFRA-02 (auth), RUNTIME-01 (agent endpoint)
- **Acceptance:** User can chat with agent, paste images, upload files. Messages stream in real-time.

### TASK: FE-02 — Generative UI Ticket Cards
- **Assignee:** Chenko
- **Priority:** High
- **Labels:** frontend, tier-2
- **Estimate:** 3-4h
- **Description:** Render structured triage output as cards in chat:
  - AI SDK tool-based generative UI: define `displayTicket` tool
  - Card shows: title, severity badge, priority, assignee, technical summary, proposed solution
  - States: `input-available` (loading skeleton), `output-available` (full card), `output-error`
  - Link to Linear issue from card
  - shadcn/ui Card, Badge, Separator components
- **Dependencies:** FE-01, AGENT-02
- **Acceptance:** Triage results render as beautiful cards in chat, not raw JSON.

### TASK: FE-03 — Auth Pages (Login/Register)
- **Assignee:** Chenko
- **Collaborator:** Lucy (backend auth)
- **Priority:** Urgent
- **Labels:** frontend, auth, tier-1
- **Estimate:** 2h (included in FE-01 estimate)
- **Description:** Login and registration pages:
  - Email/password form
  - Better Auth client SDK integration
  - Redirect to chat after login
  - Protected routes (redirect to login if unauthenticated)
- **Dependencies:** INFRA-02
- **Acceptance:** User can register, login, and access protected chat page.

---

## EPIC: Stretch Goals (Tier 3)

### TASK: STRETCH-01 — Electron/Tauri Wrapper
- **Assignee:** Chenko
- **Priority:** Medium
- **Labels:** frontend, stretch, tier-3
- **Estimate:** 2-3h
- **Description:** Wrap the TanStack web app in Electron for desktop experience. Double-click to launch instead of `localhost:3000`.
- **Dependencies:** FE-01 complete
- **Acceptance:** Desktop app opens with chat interface.

### TASK: STRETCH-02 — Jira Integration
- **Assignee:** Coqui
- **Priority:** Medium
- **Labels:** integration, stretch, tier-3
- **Estimate:** 1-2h
- **Description:** Add Jira as alternative ticketing system. Same tool interface as Linear, different API calls.
- **Dependencies:** INTEG-01 pattern established
- **Acceptance:** User can configure Jira instead of Linear. Tickets created in Jira.

### TASK: STRETCH-03 — GitHub Issues Integration
- **Assignee:** Coqui
- **Priority:** Medium
- **Labels:** integration, stretch, tier-3
- **Estimate:** 1-2h
- **Description:** Add GitHub Issues as alternative ticketing system via `gh` CLI or API.
- **Dependencies:** INTEG-01 pattern established
- **Acceptance:** User can configure GitHub Issues. Issues created in correct repo.

### TASK: STRETCH-04 — Resolution Reviewer (CodeRabbit-style)
- **Assignee:** Lalo
- **Priority:** Medium
- **Labels:** agent, stretch, tier-3
- **Estimate:** 3-4h
- **Description:** When PR is submitted for a ticket, agent reviews the code changes:
  - Fetch PR diff via GitHub/Linear API
  - Analyze changes against original issue description
  - Leave review comment with findings
  - Approve or request changes
- **Dependencies:** AGENT-03
- **Acceptance:** PR gets an automated review comment from the agent.

### TASK: STRETCH-05 — json-render Full Layout Composition
- **Assignee:** Chenko
- **Priority:** Medium
- **Labels:** frontend, stretch, tier-3
- **Estimate:** 2-3h
- **Description:** Use `@json-render/react` + `@json-render/shadcn` for LLM-composed UI layouts. Define component catalog, let agent compose ticket dashboards dynamically.
- **Dependencies:** FE-02
- **Acceptance:** Agent can compose multi-card layouts in chat.

---

## EPIC: Documentation (Tier 4 — MUST DO)

### TASK: DOCS-01 — README.md
- **Assignee:** Lalo
- **Priority:** Low (but mandatory)
- **Labels:** documentation, tier-4
- **Estimate:** 1h
- **Description:** Architecture overview, setup instructions, project summary. Include system diagram.
- **Dependencies:** All Tier 1 tasks complete
- **Acceptance:** Clear, concise, covers architecture and setup.

### TASK: DOCS-02 — AGENTS_USE.md
- **Assignee:** All (Lalo leads)
- **Priority:** Low (but mandatory)
- **Labels:** documentation, tier-4
- **Estimate:** 2-3h
- **Description:** Fill 9 sections from template:
  1. Agent overview + tech stack
  2. Agents & capabilities (one per agent)
  3. Architecture, orchestration, error handling (include diagram)
  4. Context engineering approach
  5. Use cases with step-by-step flows
  6. **Observability — EVIDENCE REQUIRED** (Langfuse screenshots, trace samples)
  7. **Security — EVIDENCE REQUIRED** (prompt injection test, PII redaction)
  8. Scalability summary
  9. Lessons learned
- **Dependencies:** INFRA-04 (observability evidence), SEC-01 (security evidence)
- **Acceptance:** All 9 sections filled. Sections 6 and 7 have actual screenshots/logs.

### TASK: DOCS-03 — SCALING.md
- **Assignee:** Lucy
- **Priority:** Low (but mandatory)
- **Labels:** documentation, tier-4
- **Estimate:** 1h
- **Description:** How the app scales: Docker Compose → Kubernetes, container replication, LibSQL primary/replica, Langfuse scaling, bottleneck analysis, assumptions.
- **Dependencies:** All Tier 1 tasks complete
- **Acceptance:** Clear explanation of scaling approach with assumptions documented.

### TASK: DOCS-04 — QUICKGUIDE.md
- **Assignee:** Coqui
- **Priority:** Low (but mandatory)
- **Labels:** documentation, tier-4
- **Estimate:** 1h
- **Description:** Step-by-step: clone → copy `.env.example` → fill keys → `docker compose up --build`. Include OpenRouter setup instructions.
- **Dependencies:** INFRA-01
- **Acceptance:** Someone can follow the guide and get the app running.

### TASK: DOCS-05 — Demo Video (3 min YouTube)
- **Assignee:** All (Lucy leads production)
- **Priority:** Low (but mandatory)
- **Labels:** documentation, tier-4
- **Estimate:** 2-3h
- **Description:** Pre-recorded, scripted demo:
  - 0:00-0:20 — Intro: what is this, tech stack
  - 0:20-0:50 — Wiki generation (time-lapse Solidus understanding)
  - 0:50-1:50 — Submit incident → triage → ticket created → email sent
  - 1:50-2:20 — Resolution → verify changes → reporter notified
  - 2:20-2:45 — Observability dashboard (Langfuse traces)
  - 2:45-3:00 — Security demo (prompt injection blocked) + closing
  - Upload to YouTube, tag #AgentXHackathon
- **Dependencies:** All Tier 1 + most Tier 2 complete
- **Acceptance:** Video under 3 min, shows full E2E flow, English, tagged correctly.

---

## Task Count Summary

| Assignee | Tier 1 | Tier 2 | Tier 3 | Tier 4 | Total |
|----------|--------|--------|--------|--------|-------|
| **Lalo** | 2 | 3 | 1 | 2 | 8 |
| **Lucy** | 3 | 2 | 0 | 2 | 7 |
| **Coqui** | 2 | 4 | 2 | 1 | 9 |
| **Chenko** | 2 | 1 | 2 | 0 | 5 |
| **All** | — | — | — | 2 | 2 |
| **Total** | 9 | 10 | 5 | 7 | **31** |

## Dependency Graph (Critical Path)

```
INFRA-01 (Docker) ──┬── RUNTIME-01 (Mastra) ──┬── INTEG-01 (Linear) ──── AGENT-01 (Workflow)
                    │                          │                              │
                    ├── INFRA-02 (Auth) ────── FE-01 (Chat UI)               ├── AGENT-02 (Triage)
                    │                          │                              │
                    └── INFRA-03 (Email)       └── FE-02 (Cards)             └── AGENT-03 (Resolution)
                                                                              │
                                               CONTEXT-01 (Wiki) ────────────┘
```

**Critical path:** INFRA-01 → RUNTIME-01 → INTEG-01 → AGENT-01 → AGENT-02 → AGENT-03
**Parallel path:** INFRA-01 → INFRA-02 → FE-01 → FE-02
