---
stepsCompleted: [1, 2]
inputDocuments: ['HACKATHON_CONTEXT/assignment.md', 'HACKATHON_CONTEXT/deliverables.md', 'HACKATHON_CONTEXT/official_rules.md', 'HACKATHON_CONTEXT/technical_requirements.md', 'HACKATHON_CONTEXT/resources_for_hackathon.md', 'HACKATHON_CONTEXT/AGENTS_USE.md']
session_topic: 'SRE Incident Intake & Triage Agent for Solidus E-Commerce — AgentX Hackathon 2026'
session_goals: 'Define complete scope, features, architecture, UX, tasks for a winning SRE agent'
selected_approach: 'ai-recommended'
techniques_used: ['morphological-analysis', 'resource-constraints']
ideas_generated: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]
context_file: ''
---

## Session Overview

**Topic:** SRE Incident Intake & Triage Agent for Solidus (Ruby on Rails) e-commerce platform.

**Goals:**
- Complete feature scope for hackathon submission
- Architecture for multi-agent orchestration with full observability
- UX for incident submission UI
- Task breakdown for Lalo, Lucy, Coqui, Chenko
- Hit ALL 6 eval criteria: Reliability, Observability, Scalability, Context Engineering, Security, Documentation
- Plan evidence capture for AGENTS_USE.md sections 6 and 7

## Decisions Captured

### Notifications
- **Email**: Priority #1 via Resend (agenticengineering.lat domains)
- **Slack**: Stretch goal after core flow
- **Matrix**: Deprioritized

### User Management
- Registration system: name, email, Linear username, Slack ID, preferred channel
- Chat agent can add/manage users via conversation
- Batch submissions: one person submits multiple issues, agent splits and parallelizes
- Assignee resolution based on expertise area (backend/frontend/DB)

### Agent Architecture
- **Orchestrator agent** receives input from UI
- **Mastra workflows** handle flow programmatically
  - Intake → Triage → Ticket creation → Notification → Wait for resolution → Notify reporter
- Batch: orchestrator splits into parallel branches per ticket
- Agents are general-purpose (not repo-specialized)
- Key agents:
  1. **Orchestrator** — routes, dispatches, manages flow
  2. **Triage Agent** — analyzes issue against codebase wiki, produces technical summary + proposed solution, assigns severity/priority/assignee
  3. **Resolution Reviewer** (stretch) — on ticket completion, checks for PR/commits, validates changes, CodeRabbit-style review

### Context Engineering / Codebase Understanding
- llm-wiki approach: two-pass (per-file summaries → cross-file synthesis)
- Stored in Postgres (not in target repo — may not have write access)
- Auto-generated when project is connected
- Agents reference wiki for triage

### Ticketing
- Linear first → Jira → GitHub Issues (modular, ~30 min per integration)
- Linear via `@linear/sdk` wrapped as Mastra tools

### UI/UX
- Chat-first interface (natural language incident submission)
- Copilot-style: helps users describe issues, asks clarifying questions
- Multimodal: text + screenshots + logs + video
- Agent auto-fills: title, description, severity, assignee, priority
- JSON Forms/Schema renderer for structured ticket cards in chat
- Kanban board second page — one-way sync from Linear (read-only)
- Possible Electron/Tauri wrapper (stretch)
- Generative UI with JSON renderer for dynamic cards (stretch)

### Tech Stack
- **Mastra** (v1.23) — orchestration, workflows, observability, durable execution
- **Better Auth** — self-hosted auth, Postgres-backed, ~30-45 min setup
- **Postgres + pgvector** (`pgvector/pgvector:pg17` ~120MB Docker image)
- **`@mastra/pg` + `@mastra/vector-pg`** — storage + vectors
- **Langfuse** — observability (native Mastra exporter, ~1.05GB total, 6 containers)
- **Resend** — email notifications
- **Linear** via `@linear/sdk` — ticketing
- **OpenRouter** free (Qwen 3.6 Plus) — multimodal LLM
- **TanStack** (Router + Query) — frontend
- **@jsonforms/react** or **shadcn-autoform** — structured UI rendering

### Docker Architecture
- Container 1: Frontend (TanStack)
- Container 2: Runtime (Mastra + Agents + Better Auth + Linear/Resend tools)
- Container 3: Database (Postgres + pgvector)
- Container 4+: Langfuse stack (web + worker + ClickHouse + Redis + MinIO + Postgres)

### Scaling
- Docker Compose for dev/demo
- Kubernetes for production (elastic scaling)
- Only runtime + DB need scaling
- Document in SCALING.md

### Optional Extras
- Severity scoring (structured output, easy)
- Deduplication (programmatic check before ticket creation)
- Runbook suggestions (included in ticket descriptions + project docs)

### Resolution Flow
- Linear webhook → Mastra workflow resume endpoint
- Agent verifies: checks PR/commits, compares before/after
- No evidence → sends back to review
- Handles PR-based and direct-push workflows
- Verified → notifies original reporter via email

### Mastra Workflow Pattern
- `suspend()` / `resume()` for human-in-the-loop
- State persisted to Postgres via `@mastra/pg`
- Linear webhook calls `POST /api/workflows/:workflowId/resume`
- `.branch()`, `.parallel()`, `.foreach()` for control flow
- Durable execution survives restarts

### Timeline
- Tuesday April 7, 2PM → Thursday April 9, 9PM COT (~55 hours)
- 4 people + AI coding tools = ~140-160 person-hours

## Research Results

### Mastra Workflows
- First-class suspend/resume with typed schemas
- Durable execution via Postgres snapshots
- REST API for resume: `POST /api/workflows/:workflowId/resume`
- Control flow: branch, parallel, foreach, dowhile, dountil, sleep, sleepUntil
- No built-in Linear package — use `@linear/sdk` as custom tools or MCP

### Langfuse vs OPIC
- Langfuse: ~1.05GB, 6 containers, native Mastra exporter, simpler setup
- OPIC: ~1.53GB, 7-8 containers, generic OTLP only, needs ZooKeeper
- Decision: Langfuse

### Better Auth
- Self-hosted, embedded in app, Postgres-backed
- 30-45 min setup, email/password + social OAuth
- No extra container needed

### Neon Local
- NOT truly local — cloud proxy requiring internet + Neon account
- Decision: Skip Neon, use plain Postgres + pgvector in Docker

### JSON Forms
- @jsonforms/react: best for dual-mode (editable forms + read-only cards)
- shadcn-autoform: lighter alternative if using shadcn/ui

### llm-wiki
- Two-pass: per-file summaries → cross-file synthesis
- Output: structured Markdown with cross-references
- Store in Postgres for RAG queries by triage agent
