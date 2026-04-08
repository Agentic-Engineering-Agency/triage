# Final Tech Stack — SRE Incident Triage Agent

## Core Stack

| Component | Technology | Package/Image | Size |
|-----------|-----------|--------------|------|
| Agent Orchestration | **Mastra** v1.23 | `@mastra/core` | — |
| AI Provider | **Vercel AI SDK** | `@ai-sdk/react`, `ai` | — |
| LLM Provider | **OpenRouter** (free) | `@openrouter/ai-sdk-provider` | — |
| Current Model | **Qwen 3.6 Plus** (multimodal) | via OpenRouter free router | — |
| Database | **LibSQL** (sqld) | `ghcr.io/tursodatabase/libsql-server:latest` | 231 MB |
| Vector Search | **Native LibSQL** | `F32_BLOB` + DiskANN, `@mastra/libsql` (LibSQLVector) | included |
| Storage | **Mastra LibSQL** | `@mastra/libsql` (LibSQLStore) | — |
| ORM | **Drizzle** | `drizzle-orm/libsql`, `@libsql/client` | — |
| Auth | **Better Auth** | `better-auth`, Drizzle adapter, `provider: 'sqlite'` | — |
| Frontend | **TanStack** | `@tanstack/react-router`, `@tanstack/react-query` | — |
| Chat UI | **AI SDK useChat** | `@ai-sdk/react` → Mastra endpoint | — |
| Generative UI | **AI SDK tools** + **json-render** | `@json-render/react`, `@json-render/shadcn` | — |
| UI Components | **shadcn/ui** | Various | — |
| Observability | **Langfuse** (self-hosted) | `langfuse/langfuse:3`, `langfuse/langfuse-worker:3` | ~1.05 GB |
| Langfuse Export | **Native Mastra exporter** | `LangfuseExporter` in Mastra config | — |
| Email | **Resend** | `resend` | — |
| Ticketing | **Linear** | `@linear/sdk` as Mastra tools + MCP | — |
| Wiki Generation | **llm-wiki approach** | Custom (two-pass, stored in LibSQL) | — |
| HTTP Security | **Helmet.js** | `helmet` | — |
| XSS Prevention | **DOMPurify** | `dompurify` | — |
| Input Validation | **Zod** | `zod` (used throughout Mastra + AI SDK) | — |

## Docker Compose Containers

| # | Container | Image | Approx Size | Purpose |
|---|-----------|-------|-------------|---------|
| 1 | Frontend | Custom (Node/TanStack build) | ~100 MB | Chat + Kanban SPA |
| 2 | Runtime | Custom (Node/Mastra) | ~200 MB | Agents, workflows, auth, tools |
| 3 | Database | `ghcr.io/tursodatabase/libsql-server` | ~231 MB | Storage + vectors |
| 4 | Langfuse Web | `langfuse/langfuse:3` | ~287 MB | Observability UI |
| 5 | Langfuse Worker | `langfuse/langfuse-worker:3` | ~281 MB | Async processing |
| 6 | ClickHouse | `clickhouse/clickhouse-server` | ~220 MB | Langfuse analytics |
| 7 | Redis | `redis:7` | ~50 MB | Langfuse queue |
| 8 | MinIO | `minio/minio` | ~63 MB | Langfuse blob storage |
| 9 | Langfuse Postgres | `postgres:17` | ~148 MB | Langfuse metadata |

**Total estimated pull: ~1.6 GB**

## Integration Map

```
User (Chat UI)
    │
    ▼
TanStack + AI SDK useChat ──→ Mastra Agent Endpoint (HTTP)
    │                              │
    │ json-render cards            ├── Triage Agent
    │ ticket display               │     ├── Queries LibSQL wiki (RAG)
    │                              │     ├── Structured output (severity, priority, assignee)
    │                              │     └── Proposes solution
    │                              │
    │                              ├── Mastra Workflow
    │                              │     ├── Dedup check (programmatic)
    │                              │     ├── Create Linear ticket (@linear/sdk)
    │                              │     ├── Send email (Resend)
    │                              │     ├── suspend() — wait for resolution
    │                              │     ├── [Linear webhook → resume()]
    │                              │     ├── Verify changes (PR/commits)
    │                              │     └── Notify reporter (Resend)
    │                              │
    │                              ├── Better Auth (sessions, users)
    │                              │
    │                              └── Langfuse Exporter (all traces)
    │
    ▼
LibSQL (sqld)                    Langfuse Stack
├── User tables (Better Auth)    ├── Traces, spans, logs
├── Wiki docs (F32_BLOB vectors) ├── ClickHouse analytics
├── Workflow state (Mastra)      └── Dashboard UI
└── Agent memory (threads)
```

## Fallback Options

| Component | Primary | Fallback |
|-----------|---------|----------|
| LLM | OpenRouter free (Qwen 3.6+) | OpenRouter free router (auto-selects), Groq free, Gemini free, paid OpenRouter |
| Database | LibSQL in Docker | `file:./local.db` (embedded, no container) |
| Observability | Langfuse | Raw OpenTelemetry + screenshots |
| Ticketing | Linear | Console log + mock (for demo) |
| Email | Resend | Console log + mock (for demo) |
| Auth | Better Auth | Hardcoded user (for demo) |
| Webhooks | Linear webhook → Cloudflare Tunnel | Mock trigger button in UI |
