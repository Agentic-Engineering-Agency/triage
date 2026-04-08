# AGENTS_USE.md — How We Use AI Agents in Triage

# Agent #1 — Orchestrator

## 1. Agent Overview

**Agent Name:** Orchestrator Agent
**Purpose:** The Orchestrator is the primary user-facing agent. It receives incident reports through a chat interface (text + images/logs), detects whether the input is a single or batch incident, and routes it through the triage workflow. It acts as the conversational layer between users and the automated triage pipeline, managing context flow and surfacing structured results via generative UI components.
**Tech Stack:** TypeScript, Mastra v1.23, AI SDK, OpenRouter (Qwen 3.6 Plus multimodal / Mercury), LibSQL, Langfuse

---

## 2. Agents & Capabilities

### Agent: Orchestrator

| Field | Description |
|-------|-------------|
| **Role** | User-facing conversational agent. Receives incident reports, detects batch vs single incidents, invokes the triage workflow, and streams structured results back to the user. |
| **Type** | Semi-autonomous — human-in-the-loop for ticket creation approval |
| **LLM** | OpenRouter (Qwen 3.6 Plus multimodal for default, Mercury for demo) |
| **Inputs** | Text descriptions, images (screenshots, diagrams), log files (.log, .txt), clipboard pastes |
| **Outputs** | Structured triage cards (severity, root cause, file references), ticket creation prompts, resolution notifications |
| **Tools** | `triageWorkflow` (Mastra workflow tool), chat streaming via AI SDK SSE protocol |

### Agent: Triage Agent

| Field | Description |
|-------|-------------|
| **Role** | Core intelligence agent. Analyzes incidents against the codebase knowledge base (wiki), identifies root cause down to specific files/functions, scores severity and confidence, and produces a structured triage output. |
| **Type** | Autonomous — runs as a step within the triage workflow |
| **LLM** | OpenRouter (same model as Orchestrator) |
| **Inputs** | Incident description (text + attachments), codebase wiki context (RAG results) |
| **Outputs** | `TriageOutput` — severity, priority, root cause analysis, affected files, proposed fix, confidence score, suggested assignee |
| **Tools** | `queryWiki` (RAG via LibSQLVector), `listIssues` (deduplication check) |

### Agent: Resolution Reviewer

| Field | Description |
|-------|-------------|
| **Role** | Verifies that resolved tickets have actual code changes (PRs/commits) that address the original issue. Prevents false resolutions where tickets are marked "done" without evidence of a fix. |
| **Type** | Autonomous — triggered by Linear webhook when ticket status changes to "Done" |
| **LLM** | OpenRouter (same model) |
| **Inputs** | Original triage output, linked PR/commit data from Linear |
| **Outputs** | Verification result: confirmed fix / insufficient evidence / needs review |
| **Tools** | Linear tools (getIssue, PR data), `sendResolutionEmail` (Resend) |

---

## 3. Architecture & Orchestration

- **Architecture diagram:**

```mermaid
graph TD
    subgraph Frontend["Frontend (Caddy + SPA)"]
        Browser["Browser :3001"]
        UI["TanStack SPA"]
        Chat["useChat (AI SDK)"]
    end

    subgraph Runtime["Runtime (Mastra :4111)"]
        SEC["Security Pipeline<br/>Injection → PII → Scrub"]
        ORCH["Orchestrator Agent"]
        WF["Triage Workflow"]
        TA["Triage Agent"]
        RR["Resolution Reviewer"]
    end

    subgraph Storage["Data Layer"]
        LIBSQL["LibSQL :8080<br/>App DB + Vectors"]
        LINEAR["Linear API<br/>Ticketing"]
        RESEND["Resend API<br/>Email"]
    end

    subgraph Observability["Observability (Langfuse)"]
        LF_WEB["langfuse-web :3000"]
        LF_WORK["langfuse-worker :3030"]
        CH["ClickHouse"]
        REDIS["Redis"]
        MINIO["MinIO"]
        PG["Postgres"]
    end

    Browser -->|HTTPS| UI
    UI -->|SSE stream| Chat
    Chat -->|/api/agents/orchestrator/stream| SEC
    SEC --> ORCH
    ORCH -->|invoke| WF
    WF -->|step| TA
    WF -->|step| RR
    TA -->|RAG query| LIBSQL
    WF -->|create ticket| LINEAR
    WF -->|send email| RESEND
    Runtime -->|traces| LF_WEB
    LF_WEB --> LF_WORK
    LF_WORK --> CH
    LF_WORK --> REDIS
    LF_WORK --> MINIO
    LF_WEB --> PG
```

- **Orchestration approach:** Sequential pipeline orchestrated by Mastra durable workflows. The Orchestrator agent invokes the `triageWorkflow` as a tool. The workflow progresses through ordered steps: intake → triage → dedup → approval gate (suspend) → ticket creation → notification → suspend for resolution → verify → notify reporter.

- **State management:** Mastra workflows persist state to LibSQL. Workflow state survives container restarts. Suspend/resume pattern enables the workflow to pause waiting for user approval (ticket creation) or external events (Linear webhook for resolution). Chat state managed by AI SDK `useChat` on the frontend.

- **Error handling:** Tool-level error boundaries — each tool wraps its logic in try/catch and returns `{ success: false, error: "..." }`. Workflow steps check tool results and either retry once or enter error state. Email failures never block triage. Linear API failure triggers local fallback ticket storage in LibSQL.

- **Handoff logic:** Orchestrator → triageWorkflow (tool invocation) → Triage Agent (workflow step) → Resolution Reviewer (webhook-triggered workflow resume). Each handoff passes typed data validated by Zod schemas.

---

## 4. Context Engineering

- **Context sources:**
  - User input: text descriptions, images (screenshots, UI mockups), log files
  - Codebase knowledge base: pre-generated llm-wiki stored as vector embeddings in LibSQL
  - Linear ticket history: existing issues queried for deduplication
  - Incident metadata: timestamps, reporter identity, project context

- **Context strategy:** Two-pass llm-wiki approach:
  1. **Pass 1 (per-file):** Each file in the connected codebase (Solidus, a Ruby on Rails e-commerce platform) is summarized individually — purpose, key functions, dependencies
  2. **Pass 2 (synthesis):** Cross-module analysis identifies architectural patterns, data flows, and component relationships
  3. **Storage:** Summaries chunked and embedded using `text-embedding-3-small` (1536 dimensions), stored as `F32_BLOB` in LibSQL with DiskANN indexing
  4. **Retrieval:** RAG via `vector_top_k('wiki_chunks_idx', queryEmbedding, 10)` returns the 10 most relevant code context chunks for each incident

- **Token management:** Context window managed through chunk-level retrieval (not full documents). RAG returns only the most relevant 10 chunks. Images resized client-side via Canvas API before upload. File size limits enforced: 10MB/file, 25MB/message.

- **Grounding:** All triage outputs are grounded in actual codebase data via RAG. Confidence scoring flags low-certainty results (below threshold). Structured output via Zod schemas prevents hallucinated fields. File references in triage output point to real files in the wiki.

---

## 5. Use Cases

### Use Case 1: Single Incident Triage

- **Trigger:** User describes an incident in the chat interface (e.g., "The checkout page is showing a 500 error when users try to apply discount codes") and optionally attaches a screenshot
- **Steps:**
  1. Frontend sends message + attachments via AI SDK SSE to Orchestrator
  2. Security pipeline validates input (prompt injection check, PII redaction)
  3. Orchestrator detects single incident, invokes triage workflow
  4. Triage Agent queries wiki for relevant codebase context (RAG)
  5. Triage Agent produces structured `TriageOutput` with severity, root cause, affected files, proposed fix
  6. Workflow checks for duplicate tickets in Linear
  7. Triage card rendered in chat UI with "Create Ticket" approval button
  8. User approves → Linear ticket created with full triage details
  9. Email notification sent to assigned engineer
  10. Workflow suspends, waiting for resolution
- **Expected outcome:** Fully triaged ticket created in Linear within 60 seconds, assigned to the correct engineer, with root cause analysis citing specific files

### Use Case 2: Resolution Verification

- **Trigger:** Engineer marks Linear ticket as "Done" → Linear fires webhook
- **Steps:**
  1. Webhook arrives at `/api/webhooks/linear` via Cloudflare Tunnel
  2. Workflow resumes from suspend state
  3. Resolution Reviewer agent checks linked PRs/commits against original triage
  4. Reviewer verifies code changes address the identified root cause
  5. If verified: resolution email sent to original reporter
  6. If insufficient: ticket reopened with review notes
- **Expected outcome:** Reporter receives notification confirming fix shipped, with evidence. False resolutions caught before reporter is notified.

### Use Case 3: Batch Incident Detection

- **Trigger:** User describes multiple issues in a single message
- **Steps:**
  1. Orchestrator detects batch pattern (multiple distinct issues)
  2. Each incident processed through its own triage workflow instance
  3. Results rendered as separate triage cards in chat
- **Expected outcome:** All incidents triaged independently with separate tickets

---

## 6. Observability

- **Logging:** Structured console logging in runtime. All log messages include correlation ID when available. Security events (injection blocked, PII redacted) logged at `warn` level. Secrets and PII never logged.

- **Tracing:** End-to-end Langfuse traces with correlation IDs spanning the full lifecycle: intake → security check → triage → dedup → ticket creation → notification → resolution verification → reporter notification. Each agent call, tool invocation, and workflow step is a span in the trace. `LangfuseExporter` configured in Mastra instance.

- **Metrics:**
  - Latency: time-to-first-token, total triage time, per-step durations
  - Token usage: input/output tokens per agent call, cost per triage
  - Success/failure rates: triage completion rate, ticket creation success, email delivery
  - Security: prompt injection attempts blocked, PII redaction events

- **Dashboards:** Langfuse web dashboard at `http://localhost:3000` provides trace timeline views, token cost analytics, and latency distributions.

### Evidence

<!-- EVIDENCE: Add Langfuse trace screenshots showing:
  1. Full E2E trace from intake to ticket creation (with correlation ID)
  2. Token usage breakdown per agent call
  3. Latency timeline for a complete triage
  4. Security event log showing blocked injection attempt
  Add screenshots here once the agent pipeline is operational.
-->

> **Status:** Evidence pending — requires operational agent pipeline. Langfuse infrastructure is deployed and verified healthy (v3.22.0). Trace collection will be captured during demo recording.

---

## 7. Security & Guardrails

- **Prompt injection defense:** Mastra security processor pipeline runs on ALL user input before it reaches any agent:
  1. **Prompt injection detector** (block strategy, threshold 0.7) — rejects malicious input with generic message, logged to Langfuse
  2. **PII redactor** (redact strategy) — strips emails and API keys before LLM context
  3. **System prompt scrubber** (filter strategy) — prevents prompt extraction from agent outputs

- **Input validation:**
  - File type whitelist: png, jpg, gif, log, txt, mp4, webm
  - File size limits: 10MB per file, 25MB per message
  - Client-side validation in composer (pre-send) + server-side validation in runtime
  - Image resizing via Canvas API before upload

- **Tool use safety:** Tool-level error boundaries prevent unintended cascading. Each tool returns typed success/error responses validated by Zod schemas. Linear ticket creation requires explicit user approval (Confirmation component) — no autonomous ticket creation without human-in-the-loop gate.

- **Data handling:**
  - All secrets via environment variables (`.env` file, never committed)
  - 17 secrets documented in `.env.example` with CHANGEME placeholders
  - Caddy security headers: HSTS, X-Frame-Options DENY, X-Content-Type-Options nosniff, CSP, Referrer-Policy
  - Better Auth with HttpOnly, SameSite=Lax cookies
  - DOMPurify for XSS prevention on rendered content

### Evidence

<!-- EVIDENCE: Add evidence showing:
  1. Prompt injection attempt blocked (input + agent response + Langfuse trace)
  2. PII redaction in action (before/after in trace)
  3. File validation rejecting oversized/wrong-type upload
  4. Security headers visible in browser DevTools
  Add screenshots here once the agent pipeline is operational.
-->

> **Status:** Evidence pending — requires operational agent pipeline. Security infrastructure is in place: Caddy security headers verified, `.env.example` with 17 secrets documented, `scripts/check-env.sh` validates no CHANGEME values remain.

---

## 8. Scalability

Triage is designed to scale from a single Docker Compose deployment to a production Kubernetes cluster. See [`SCALING.md`](./SCALING.md) for the full analysis.

- **Current capacity:** 9-container Docker Compose stack runs on a single machine. Suitable for development and small team usage (1-10 concurrent users). All images pull in <2GB total.

- **Scaling approach:**
  - **Horizontal:** Frontend (Caddy) and Runtime (Mastra) are stateless — scale with replicas behind a load balancer. Langfuse worker scales as queue consumers.
  - **Vertical:** LibSQL (single-writer), ClickHouse (analytical queries), Redis (in-memory cache) scale vertically.
  - **Kubernetes path:** Helm chart with 14 templates, HPAs for frontend/runtime (autoscaling/v2, 50% CPU target), LibSQL StatefulSet with PVC, Bitnami subcharts for Postgres, ClickHouse, Redis, MinIO.

- **Bottlenecks identified:**
  1. Runtime ↔ LLM latency (OpenRouter API calls are the primary bottleneck)
  2. LibSQL write throughput (single-writer architecture)
  3. ClickHouse ingestion (high trace volume)
  4. Network egress (LLM API calls)

---

## 9. Lessons Learned & Team Reflections

<!-- TODO: Fill after hackathon completion. Document:
  - What worked well: approaches, tools, or decisions that paid off
  - What you would do differently: with more time or resources
  - Key technical decisions: trade-offs made and why
-->

> **Status:** To be completed after the hackathon build sprint.

- **What worked well:**
  - SpecSafe TDD pipeline for infrastructure — 192 tests before any production code
  - Docker Compose with stub fallbacks — full 9-container stack runnable from Day 1
  - Network segmentation (app + langfuse) — clean separation of concerns
  - Planning-first approach (BMAD methodology) — architecture decisions locked before coding

- **What you would do differently:**
  <!-- TODO: Add retrospective items -->

- **Key technical decisions:**
  - Mastra as HTTP server (no Express) — eliminates a framework layer
  - Single-origin Caddy proxy — no CORS, session cookies work automatically
  - LibSQL for everything (app DB + vectors + workflow state) — one database to manage
  - Tool-level error boundaries — simple, consistent error handling pattern
  - Two-pass llm-wiki — per-file summaries then cross-module synthesis for deep codebase understanding

---
