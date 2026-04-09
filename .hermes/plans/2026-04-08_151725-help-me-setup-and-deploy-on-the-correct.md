# Plan: Mastra Runtime Setup & Deploy (TRI-8)

**Date:** 2026-04-08
**Author:** Lalo (via Hermes)
**Linear:** TRI-8 (RUNTIME-01 — Mastra Runtime Setup) + unblocks TRI-14 (AGENT-01), TRI-19 (FE-01)

---

## Goal

Replace the stub runtime (`stubs/runtime/index.mjs`) with a real Mastra runtime in `runtime/`, configure it to run inside the existing Docker Compose `runtime` service, and expose a working `/api/agents/orchestrator/stream` endpoint so the frontend (PR #3, branch `19/impl`) can connect for real E2E chat — no mocks.

---

## Current Context & Assumptions

1. **Stub exists.** `Dockerfile.runtime` already has a conditional: if `runtime/package.json` exists → `cd runtime && npm ci && npx mastra build` → copies `.mastra/output` to `/app/output`. Otherwise falls back to `stubs/runtime/index.mjs`. So just creating `runtime/` triggers the real build path.

2. **Docker Compose ready.** The `runtime` service is defined (port 4111, health check on `/health`, depends on `libsql`, connects to `app` + `langfuse` networks). No compose changes needed.

3. **Caddy configured.** `/api/*` and `/auth/*` already reverse-proxy to `runtime:4111` with `flush_interval -1` for SSE streaming. Frontend is served on `:3001`.

4. **Frontend expects `orchestrator` agent.** `chat.tsx` uses:
   ```ts
   const transport = new DefaultChatTransport({
     api: "/api/agents/orchestrator/stream",
     credentials: "include",
   })
   ```
   Tool components registered: `displayTriage`, `displayDuplicate`.

5. **No `.env` file exists yet** — only `.env.example`. Need to create `.env` with real values.

6. **Latest Mastra versions:** `@mastra/core@1.24.0`, `@mastra/libsql@1.8.0`, `@mastra/deployer@1.24.0`.

7. **Architecture docs lock:** OpenRouter as LLM provider, LibSQL for storage/vectors, Drizzle ORM, port 4111, `mastra.serve()` as HTTP server (built on Hono).

---

## Proposed Approach

Two-phase approach: first get a **minimal working E2E** (chat message → LLM response streamed to frontend), then layer on tooling/DB/auth in subsequent tickets.

### Phase 1: Skeleton Runtime (this plan — TRI-8)
- Scaffold Mastra project in `runtime/`
- Configure OpenRouter provider
- Create orchestrator agent (chat-capable, no tools yet)
- Wire LibSQL storage (Mastra's built-in workflow/memory storage)
- Verify Docker build + health check
- E2E: frontend sends message → runtime streams response

### Phase 2: Agents + Workflows (TRI-14, separate plan)
- Add triage agent, tools (Linear, Resend, wiki), workflows
- DB schema with Drizzle (auth tables, wiki tables, tickets)
- Structured output, generative UI tool parts

---

## Step-by-Step Plan

### Step 0: Create working branch
```bash
cd /Users/agent/triage
git checkout main && git pull
git worktree add /Users/agent/triage-runtime runtime/setup
# or branch from main: git checkout -b runtime/setup
```
All work in a worktree. Never commit to main.

---

### Step 1: Scaffold Mastra project in `runtime/`

```bash
cd /Users/agent/triage-runtime
mkdir -p runtime
cd runtime
npm init -y
```

Install dependencies:
```bash
npm install @mastra/core@latest @mastra/libsql@latest @openrouter/ai-sdk-provider zod
npm install -D typescript @types/node tsx mastra
```

Create `tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": true,
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", ".mastra"]
}
```

**Files to create:**
```
runtime/
├── package.json
├── tsconfig.json
└── src/
    └── mastra/
        ├── index.ts          ← Mastra instance
        └── agents/
            ├── index.ts      ← barrel export
            └── orchestrator.ts
```

---

### Step 2: Mastra instance (`runtime/src/mastra/index.ts`)

```ts
import { Mastra } from "@mastra/core";
import { LibSQLStore } from "@mastra/libsql";
import { orchestrator } from "./agents/index";

export const mastra = new Mastra({
  agents: { orchestrator },
  storage: new LibSQLStore({
    url: process.env.LIBSQL_URL || "http://localhost:8080",
  }),
});
```

Key points:
- Agent name MUST be `orchestrator` — frontend calls `/api/agents/orchestrator/stream`
- LibSQLStore handles Mastra's internal workflow state, thread storage, etc.
- No `LangfuseExporter` yet (TRI-6 backlog) — add later

---

### Step 3: Orchestrator agent (`runtime/src/mastra/agents/orchestrator.ts`)

```ts
import { Agent } from "@mastra/core/agent";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

export const orchestrator = new Agent({
  name: "orchestrator",
  instructions: `You are Triage, an AI-powered SRE incident triage assistant for e-commerce platforms.
You help engineers investigate, classify, and resolve production incidents.

When a user describes an incident:
1. Ask clarifying questions if the report is vague
2. Analyze the symptoms and suggest likely root causes
3. Recommend severity (Critical/High/Medium/Low)
4. Suggest investigation steps with specific files/services to check

Be concise, technical, and actionable. Use markdown for code references.`,
  model: openrouter("inception/mercury"),
});
```

Barrel export in `runtime/src/mastra/agents/index.ts`:
```ts
export { orchestrator } from "./orchestrator";
```

**NOTE on model:** Mercury is TEXT-ONLY per memory. For Phase 1 (chat only) this is fine. When multimodal is needed (TRI-14), images will go through Qwen vision first.

---

### Step 4: Verify `mastra build` works locally

```bash
cd runtime
npx mastra build
ls -la .mastra/output/
```

Expected output: `.mastra/output/` contains compiled JS + `package.json`. This is what the Dockerfile copies.

Sanity check — run locally:
```bash
PORT=4111 OPENROUTER_API_KEY=<key> LIBSQL_URL=http://localhost:8080 node .mastra/output/index.mjs
```

Verify:
- `curl http://localhost:4111/health` → 200
- `curl -X POST http://localhost:4111/api/agents/orchestrator/stream -H "Content-Type: application/json" -d '{"messages":[{"role":"user","content":"hello"}]}'` → SSE stream

---

### Step 5: Create `.env` from `.env.example`

Copy `.env.example` to `.env` and fill in real values:

```bash
# Required for Phase 1:
PORT=4111
NODE_ENV=production
LIBSQL_URL=http://libsql:8080
OPENROUTER_API_KEY=<real key>

# Langfuse infra (needed for other containers to start):
# Fill ALL values from .env.example — Langfuse stack won't boot without them
ENCRYPTION_KEY=$(openssl rand -hex 32)
SALT=$(openssl rand -hex 32)
NEXTAUTH_SECRET=$(openssl rand -hex 32)
POSTGRES_PASSWORD=$(openssl rand -hex 16)
CLICKHOUSE_PASSWORD=$(openssl rand -hex 16)
REDIS_AUTH=$(openssl rand -hex 16)
MINIO_ROOT_PASSWORD=$(openssl rand -hex 16)
# ... etc (all from .env.example)
```

**Critical:** `LIBSQL_URL` must be `http://libsql:8080` inside Docker (container hostname), NOT `http://localhost:8080`.

---

### Step 6: Docker build & test

```bash
cd /Users/agent/triage-runtime   # worktree root

# Build just the runtime to test
docker compose build runtime

# Start dependencies first
docker compose up -d libsql

# Then runtime
docker compose up runtime
```

Check logs:
- Runtime should log Mastra startup on port 4111
- Health check should pass: `docker compose ps` shows `runtime` as healthy

Test from host:
```bash
curl http://localhost:4111/health
```

---

### Step 7: Full stack E2E test

```bash
# Start all 9 containers
docker compose up -d

# Wait for health checks
docker compose ps

# Test runtime directly
curl http://localhost:4111/api/agents/orchestrator/stream \
  -X POST -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"I see 500 errors on the checkout page"}]}'

# Test through Caddy (frontend proxy)
curl http://localhost:3001/api/agents/orchestrator/stream \
  -X POST -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"hello"}]}'
```

For full E2E with the frontend:
1. Merge PR #3 (or test with `19/impl` branch)
2. Open `http://localhost:3001` in browser
3. Type a message in the chat → should stream a response from Mercury via OpenRouter

---

### Step 8: Dev mode (optional, for local iteration)

The `docker-compose.override.yml` expects `runtime/src/index.ts` for tsx watch mode. Since Mastra uses `mastra.serve()`, the entry point is the Mastra instance itself. Two options:

**Option A:** Use `mastra dev` command for local dev (recommended for Mastra projects):
```bash
cd runtime
OPENROUTER_API_KEY=<key> LIBSQL_URL=http://localhost:8080 npx mastra dev
```
This starts a dev server with hot reload at port 4111.

**Option B:** Modify override to use `mastra dev`:
```yaml
runtime:
  command: npx mastra dev --port 4111
  volumes:
    - ./runtime/src:/app/src
```

---

### Step 9: Commit & PR

```bash
cd /Users/agent/triage-runtime
git add runtime/
git commit -m "feat(runtime): Mastra runtime scaffold with orchestrator agent

- @mastra/core + @mastra/libsql + @openrouter/ai-sdk-provider
- orchestrator agent using Mercury model via OpenRouter
- LibSQLStore for Mastra workflow/thread storage
- Builds with npx mastra build, runs on port 4111
- Dockerfile.runtime conditional picks up real runtime
- Unblocks frontend E2E (TRI-19) and agent workflows (TRI-14)"

git push -u origin runtime/setup
gh pr create --title "feat(runtime): TRI-8 — Mastra runtime scaffold" \
  --body "Replaces stub with real Mastra runtime..." \
  --base main
```

---

## Files Changed / Created

| File | Action | Purpose |
|------|--------|---------|
| `runtime/package.json` | CREATE | Dependencies: @mastra/core, @mastra/libsql, @openrouter/ai-sdk-provider |
| `runtime/tsconfig.json` | CREATE | TypeScript config for runtime |
| `runtime/src/mastra/index.ts` | CREATE | Mastra instance (agents, storage) |
| `runtime/src/mastra/agents/index.ts` | CREATE | Barrel export for agents |
| `runtime/src/mastra/agents/orchestrator.ts` | CREATE | Orchestrator agent (chat with Mercury) |
| `.env` | CREATE | Environment variables (from .env.example + real keys) |
| `.gitignore` | MAYBE EDIT | Ensure `runtime/.mastra/` and `runtime/node_modules/` are ignored |

**NOT changed:**
- `docker-compose.yml` — already correct
- `Dockerfile.runtime` — already has conditional for real runtime
- `Caddyfile` — already proxies `/api/*` to runtime
- `config.json` — already correct (`apiUrl: "/api"`)

---

## Tests / Validation

1. `cd runtime && npx mastra build` exits 0
2. `curl http://localhost:4111/health` returns 200
3. `curl -X POST http://localhost:4111/api/agents/orchestrator/stream` returns SSE stream
4. `docker compose up -d && docker compose ps` — all 9 containers healthy
5. Frontend chat (`http://localhost:3001/chat`) sends message and receives streamed response
6. Caddy proxies `/api/*` correctly (test via `curl http://localhost:3001/api/agents/orchestrator/stream`)

---

## Risks, Tradeoffs & Open Questions

### Risks
- **Mastra build output format.** The Dockerfile assumes `.mastra/output/index.mjs` is the entry point. Need to verify `mastra build` actually produces this. If not, adjust Dockerfile `CMD` or output path.
- **OpenRouter rate limits.** Mercury free tier may throttle. If so, fall back to paid tier or switch model.
- **LibSQL startup race.** Runtime depends on LibSQL via `service_healthy`, but first connection might still fail. Mastra's LibSQLStore should handle retries, but worth watching.

### Tradeoffs
- **No auth in Phase 1.** Better Auth (TRI-4, Chenko) is a separate concern. The runtime will accept unauthenticated requests initially. Fine for dev/demo.
- **No tools/workflows in Phase 1.** The orchestrator just chats. No Linear tickets, no email, no RAG. This is intentional — TRI-14 layers those on.
- **Mercury text-only.** Images sent from frontend won't be processed until Qwen vision model integration (TRI-14).

### Open Questions
1. **Mastra agent endpoint path:** Docs say `/api/agents/:agentId/stream` but need to verify Mastra 1.24 uses this exact path. If different, frontend `DefaultChatTransport` URL needs updating.
2. **Thread persistence:** Does Mastra auto-persist chat threads to LibSQLStore, or do we need to pass `threadId`? Frontend doesn't send one currently.
3. **CORS:** Caddy same-origin proxy eliminates CORS, but during local dev without Docker (e.g., `mastra dev` + `vite dev`) there might be CORS issues. May need Mastra CORS config or Vite proxy.
4. **`.env` secrets:** Who provides the `OPENROUTER_API_KEY`? Fernando has it? Need to coordinate.
5. **Langfuse stack required?** For Phase 1, do we need all 6 Langfuse containers running? The runtime doesn't use Langfuse yet. Could comment them out temporarily to speed up `docker compose up`. But other team members might need them.

---

## Dependency Graph

```
TRI-3 (Docker Compose) ✅ DONE
    └── TRI-8 (Mastra Runtime Setup) ← THIS PLAN
         ├── TRI-14 (Mastra Workflow E2E) — your next ticket
         ├── TRI-19 (Frontend Chat UI) — unblocked for real testing
         ├── TRI-9 (Linear Integration) — Fernando, needs runtime running
         └── TRI-5 (Email/Resend) — Fernando, needs runtime running
```

---

## Estimated Effort

~2-3 hours for a clean implementation including Docker testing. Most time will be spent on:
- Verifying `mastra build` output matches Dockerfile expectations
- Getting `.env` right with all 9 containers
- E2E debugging through the Caddy proxy layer
