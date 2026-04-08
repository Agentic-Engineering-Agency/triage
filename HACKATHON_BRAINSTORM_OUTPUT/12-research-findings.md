# Research Findings — All Agents

## 1. Mastra Workflows (v1.23)

- **suspend/resume**: First-class, typed schemas (`resumeSchema`, `suspendSchema`), REST API `POST /api/workflows/:workflowId/resume`
- **Durable execution**: State snapshots persisted to storage (LibSQL, Postgres, etc.)
- **Sleep**: `.sleep(ms)`, `.sleepUntil(date)` — static and dynamic
- **Control flow**: `.branch()`, `.parallel()`, `.foreach()`, `.dowhile()`, `.dountil()`, nested workflows
- **No built-in triggers**: Use suspend/resume + external webhook handler
- **No Linear package**: Use MCP (`@mastra/mcp`) or `@linear/sdk` wrapped as tools
- **Waiting for ticket resolution**: Workflow suspends → Linear webhook calls resume endpoint → continues

## 2. Langfuse vs OPIC

| | Langfuse | OPIC |
|---|---|---|
| Docker pull | **~1.05 GB** | ~1.53 GB |
| Containers | **6** | 7-8 |
| Setup | Single compose, edit secrets | Custom shell script + profiles |
| Mastra | **Native `LangfuseExporter`** | Generic OTLP only |
| Extra deps | None | Requires ZooKeeper |
| **Winner** | **Langfuse** | — |

## 3. Better Auth

- Self-hosted, embedded in app, ~30-45 min setup
- Supports Postgres, SQLite, **LibSQL (via Drizzle adapter, `provider: 'sqlite'`)**
- Confirmed working with Turso/LibSQL in production (GitHub issue #5391)
- Email/password + 40+ social OAuth providers out of the box
- Config: `BETTER_AUTH_SECRET` (32+ chars) + `BETTER_AUTH_URL`

## 4. LibSQL (sqld) Self-Hosted

- Image: `ghcr.io/tursodatabase/libsql-server:latest` — **231 MB**
- ARM64: use `latest-arm` tag
- Native vector search: `F32_BLOB(dimensions)` + DiskANN, `vector_top_k()` function
- Mastra: `@mastra/libsql` → `LibSQLStore` + `LibSQLVector`
- Better Auth: via Drizzle + `@libsql/client` with `provider: 'sqlite'`
- Replication: primary/replica via gRPC, embedded replicas
- RAM at idle: ~10-20 MB (vs Postgres ~30-60 MB)
- "Self-hosted Turso" = running this image. Turso Cloud = this + management layer.
- **Turso DB** (Rust rewrite) is NOT production-ready — don't use it

## 5. Neon Local

- **NOT truly local** — cloud proxy requiring internet + Neon account
- Skip entirely. Use LibSQL instead.

## 6. JSON Forms

- `@jsonforms/react`: Best for dual-mode (editable + read-only), flexible renderers
- `react-jsonschema-form`: Simpler but less flexible for card views
- `shadcn-autoform`: Form generation only, not for display cards
- **Superseded by AI SDK tool-based generative UI for our use case**

## 7. Vercel AI SDK Generative UI

- **Mastra IS built on AI SDK** — `useChat` connects directly to Mastra agent endpoints
- **Tool-based rendering**: Define tools with Zod schemas, LLM calls them, client renders components per tool name
- **`message.parts`**: Typed array with `text`, `tool-<name>` (with `state`: input-available, output-available, output-error)
- **json-render** (`@json-render/react`): LLM generates entire UI layouts as constrained JSON. 36 pre-built shadcn components via `@json-render/shadcn`
- **OpenRouter**: `@openrouter/ai-sdk-provider` supports all models including Claude, prompt caching
- **Decision**: Use AI SDK tool-based generative UI for ticket cards. json-render for more complex layouts if time allows.

## 8. llm-wiki (Karpathy)

- Two-pass: (1) per-file summaries, (2) cross-file concept synthesis with interlinking
- Output: structured Markdown with cross-references
- Can be adapted to focus on failure modes, error handling, dependencies
- Store in LibSQL for RAG queries by triage agent
- Cost concern mitigated by OpenRouter free tier
