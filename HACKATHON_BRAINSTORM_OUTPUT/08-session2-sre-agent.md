---
session: 2
date: 2026-04-07
topic: SRE Incident Intake & Triage Agent for Solidus E-Commerce
hackathon: AgentX Hackathon 2026 by SoftServe
deadline: 2026-04-09 9PM COT
team: Lalo, Lucy, Coqui, Chenko
---

# Session 2: SRE Incident Intake & Triage Agent — Complete Brainstorm

## Assignment Summary

Build an SRE Incident Intake & Triage Agent that:
1. Accepts multimodal incident reports (text + images/logs/video) via chat UI
2. Triages by analyzing the Solidus (Ruby on Rails) codebase + docs
3. Produces technical summary + proposed solution + severity/priority/assignee
4. Creates ticket in Linear
5. Notifies team via email (Resend)
6. On resolution, verifies changes (PR/commits), notifies original reporter

## Final Tech Stack

| Component | Technology | Notes |
|-----------|-----------|-------|
| Orchestration | Mastra (v1.23) + Vercel AI SDK | Built on AI SDK, first-class workflows |
| Database | LibSQL (sqld) `ghcr.io/tursodatabase/libsql-server` | 231 MB, native vectors |
| Vectors | Native LibSQL (`F32_BLOB` + DiskANN) via `@mastra/libsql` | No separate vector DB |
| Auth | Better Auth via Drizzle + `@libsql/client` | Self-hosted, embedded |
| ORM | Drizzle ORM (`drizzle-orm/libsql`) | Required for Better Auth |
| Observability | Langfuse (native `LangfuseExporter` in Mastra) | ~1.05 GB stack |
| Email | Resend | agenticengineering.lat domains |
| Ticketing | Linear via `@linear/sdk` as Mastra tools + MCP | First integration |
| LLM | OpenRouter free (`@openrouter/ai-sdk-provider`) | Qwen 3.6 Plus multimodal |
| Frontend | TanStack (Router + Query) + AI SDK `useChat` | SPA, real-time |
| Generative UI | AI SDK tool-based generative UI + json-render | Ticket cards in chat |
| Wiki | llm-wiki approach (two-pass) → stored in LibSQL | Codebase understanding |

## Docker Compose Architecture

```
┌──────────────────┐  ┌────────────────────────────┐  ┌───────────────────┐
│  Frontend        │  │  Runtime                    │  │  Database          │
│  TanStack SPA    │→ │  Mastra + Agents            │→ │  LibSQL sqld       │
│  AI SDK useChat  │  │  Better Auth (embedded)     │  │  (231 MB)          │
│  json-render     │  │  Drizzle ORM                │  │  Native vectors    │
│                  │  │  Linear/Resend tools        │  │  F32_BLOB+DiskANN  │
│                  │  │  Langfuse Exporter          │  │                    │
└──────────────────┘  └────────────────────────────┘  └───────────────────┘
                               │
                               ▼
                  ┌──────────────────────────┐
                  │  Langfuse Stack (~1 GB)   │
                  │  web + worker +            │
                  │  ClickHouse + Redis +      │
                  │  MinIO + Postgres           │
                  └──────────────────────────┘
```

**Total app containers (excluding Langfuse): ~500-600 MB**
**Total with Langfuse: ~1.6 GB**

## Agent Architecture

### Agent 1: Orchestrator
- Receives input from chat UI
- Routes to appropriate workflow
- Handles batch submissions (splits multiple issues into parallel branches)
- General-purpose (not repo-specialized)

### Agent 2: Triage Agent
- Analyzes issue against codebase wiki (llm-wiki generated docs)
- Produces: technical summary, likely root cause with file/line references, proposed solution
- Assigns: severity, priority, responsible person (based on user profiles from Linear)
- Creates Linear ticket with full details + runbook suggestions

### Agent 3: Resolution Reviewer (Stretch)
- Triggered when ticket marked complete
- Checks for PR/commits, compares before/after code
- CodeRabbit-style review
- If no evidence of changes → sends back to review
- If verified → triggers reporter notification

## Mastra Workflow Pattern

```
Intake (chat) → Triage Agent (analyze + propose solution)
    → Deduplication check (programmatic, pre-ticket)
    → Create Linear ticket (with severity, priority, assignee, runbook)
    → Notify team (email via Resend)
    → suspend() — wait for resolution
    → [Linear webhook calls resume endpoint]
    → Verify changes (check PR/commits)
    → Notify original reporter (email)
```

- `suspend()`/`resume()` for waiting on ticket resolution
- State persisted to LibSQL via `@mastra/libsql`
- Linear webhook calls `POST /api/workflows/:workflowId/resume`
- `.branch()` for severity-based routing
- `.parallel()` for batch issue processing

## UI/UX Decisions

- **Chat-first**: Natural language incident submission (copilot-style)
- **Multimodal**: Text + image paste + file upload + video (6-8h to build well)
- **Generative UI**: AI SDK tool-based rendering for ticket cards in chat
- **Kanban board**: Second page, one-way sync from Linear (read-only)
- **User management**: Import from Linear on project setup, agent fills gaps via chat
- **Electron wrapper**: Stretch goal (easy once web app works)

## Notifications

- **Email (Resend)**: Priority #1, required
- **Slack**: Tier 2 stretch goal
- **Matrix**: Deprioritized

## Optional Extras (all included)

- **Severity scoring**: Structured output from LLM, trivial
- **Deduplication**: Programmatic check in Mastra workflow before ticket creation
- **Runbook suggestions**: Included in ticket descriptions by triage agent

## Context Engineering

- **llm-wiki approach**: Two-pass (per-file summaries → cross-file synthesis)
- **Stored in LibSQL**: Native vector search for RAG queries
- **Auto-generated**: When project is connected, researcher agent generates wiki immediately
- **Per-project**: Each project has own config, skills, repo, wiki docs
- **Agents reference wiki**: Triage agent queries wiki to understand codebase deeply

## Scaling Strategy (for SCALING.md)

- Docker Compose for dev/demo
- Kubernetes for production (elastic scaling)
- Only Runtime + Database containers need scaling
- Frontend is static, minimal scaling needed
- LibSQL supports primary/replica replication for read scaling
- Langfuse handles its own scaling internally

## Resolution Flow Details

- When ticket marked "Complete" in Linear → webhook triggers Mastra workflow resume
- Agent verifies: checks for PR (preferred) or direct commits
- Handles both PR-based and direct-push workflows
- No evidence of changes → sends back to review, asks what changed
- Verified → notifies original reporter via email with summary of resolution

## Security

- Mastra processors: prompt injection detector, PII detector, system prompt scrubber
- Small local VLM model (~4B params) for security red-teaming (stretch)
- DOMPurify for XSS prevention on user inputs
- Better Auth handles session security
- Environment variables only for secrets (never committed)
- Helmet.js for HTTP security headers

## Evidence Capture Plan (for AGENTS_USE.md)

- Save all programming/coding sessions throughout development
- Langfuse captures traces automatically — screenshot dashboards
- Security: demonstrate prompt injection attempt being blocked
- Build documentation progressively, compile at end
- Use AI to generate final AGENTS_USE.md from all session data
