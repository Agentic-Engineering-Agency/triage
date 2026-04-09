# Handoff: Frontend ↔ Runtime Integration (for Koki)

**From:** Lalo (TRI-8 runtime setup)
**To:** Koki (TRI-19 frontend)
**Date:** 2026-04-08
**PR:** #5 (feature/mastra-runtime) — ready for review

---

## What's Done

The Mastra runtime is live and E2E verified. Your frontend code in `chat.tsx` already points at the correct endpoint — it should Just Work once both branches are merged to main and Docker Compose is rebuilt.

### Runtime Endpoint (verified working)

```
POST /api/agents/orchestrator/stream
Content-Type: application/json

Body: {"messages": [{"role": "user", "content": "..."}]}
Response: SSE stream (AI SDK v5 protocol)
```

- **Through Caddy (production):** `http://localhost:3001/api/agents/orchestrator/stream`
- **Direct to runtime (debugging):** `http://localhost:4111/api/agents/orchestrator/stream`
- **Health check:** `GET http://localhost:4111/health` → `{"success": true}`

### Your Transport Config — Already Correct

```ts
// frontend/src/routes/chat.tsx (already in your code)
const transport = new DefaultChatTransport({
  api: "/api/agents/orchestrator/stream",
  credentials: "include",
})
```

This works because Caddy proxies `/api/*` to `runtime:4111` with `flush_interval -1` for SSE.

---

## SSE Stream Format

The runtime sends AI SDK v5 SSE events. Here's the actual shape from a verified test:

```
data: {"type":"start","runId":"...","from":"AGENT","payload":{"id":"orchestrator","messageId":"..."}}
data: {"type":"text-start","runId":"...","from":"AGENT","payload":{"id":"gen-..."}}
data: {"type":"text-delta","runId":"...","from":"AGENT","payload":{"id":"gen-...","text":"I can hear you."}}
data: {"type":"text-end","runId":"...","from":"AGENT","payload":{...}}
data: {"type":"step-finish","runId":"...","from":"AGENT","payload":{...metadata, usage, messages...}}
data: {"type":"finish","runId":"...","from":"AGENT","payload":{...}}
data: [DONE]
```

`useChat` from `@ai-sdk/react` v3+ handles this protocol natively. The `messages` array and `status` state will update automatically.

---

## Tool Parts (Generative UI)

Your `tool-registry.tsx` expects `displayTriage` and `displayDuplicate` tool keys. These tools are NOT yet wired to agent execution (tool stubs throw "not implemented") — that's TRI-14. But the plumbing is in place:

**Runtime tool IDs → Frontend tool keys mapping:**

The frontend checks `part.type.startsWith("tool-")` and extracts the key with `part.type.replace("tool-", "")`. Mastra sends tool parts as `tool-{toolId}` where toolId is the `id` field from `createTool()`.

Current runtime tool IDs (kebab-case):
```
create-linear-issue
update-linear-issue
get-linear-issue
list-linear-issues
get-team-members
send-ticket-email
send-resolution-email
query-wiki
generate-wiki
```

**Action needed:** When TRI-14 adds display tools (`displayTriage`, `displayDuplicate`), the tool IDs in runtime must match the keys in your `toolComponents` map. Either:
- Runtime tools use `displayTriage` / `displayDuplicate` as their ID
- Or you update `tool-registry.tsx` to map the kebab-case IDs

For now, plain text chat works end-to-end. Tool UI cards will light up once TRI-14 implements the display tools.

---

## How to Run Locally

### Option 1: Full Docker Stack (recommended)

```bash
# From repo root — MUST use -f to skip override file
docker compose -f docker-compose.yml up -d libsql runtime frontend

# Or if you want to dev the frontend with Vite HMR:
docker compose -f docker-compose.yml up -d libsql runtime
cd frontend && npm run dev  # Vite on :5173, proxy /api to runtime
```

**Important:** Use `-f docker-compose.yml` explicitly. The `docker-compose.override.yml` tries to run `npx tsx watch src/index.ts` which doesn't exist — the runtime uses `mastra build` output.

### Option 2: Runtime in Docker, Frontend local

```bash
# Start runtime + libsql
docker compose -f docker-compose.yml up -d libsql runtime

# Start frontend dev server
cd frontend && npm run dev
```

You'll need to either:
- Configure Vite proxy to forward `/api/*` to `http://localhost:4111`
- Or add this to `vite.config.ts`:
```ts
server: {
  proxy: {
    '/api': 'http://localhost:4111',
  },
}
```

---

## .env Setup

Copy `.env.example` to `.env` and fill in:
- `OPENROUTER_API_KEY` — **required** (ask Lalo or Fernando)
- Everything else has defaults or is auto-generated with `openssl rand -hex 32`

The runtime validates env at startup. If `OPENROUTER_API_KEY` is missing, it crashes with a clear error.

---

## Model Info

| Model | ID | Used For |
|-------|----|----------|
| Mercury 2 | `inception/mercury-2` | Chat, triage analysis, all text (FAST, text-only) |
| Gemma 4 31B | `google/gemma-4-31b-it:free` | Image understanding (not wired yet) |
| Gemma 4 31B paid | `google/gemma-4-31b-it` | Vision fallback |

Mercury responds in ~1 second. Cost: ~$0.0003/request for short chats.

---

## What Still Needs Frontend Work

1. **Chat works NOW** — text in, text out, streamed. Test it!
2. **Tool rendering** — will work once TRI-14 wires display tools. Your `tool-registry.tsx` and `chat.tsx` rendering logic look correct.
3. **Attachments** — your file upload UI sends files but the runtime doesn't process images yet (needs Gemma 4 vision integration in TRI-14). Text files should work.
4. **Error handling** — if a tool throws "not implemented", the SSE stream will include a tool error part. Your code handles `output-error` state, so it should show the error gracefully.

---

## Quick Sanity Test

After merging both PRs and rebuilding:

```bash
# Verify runtime is up
curl http://localhost:4111/health
# → {"success": true}

# Test stream directly
curl -N http://localhost:4111/api/agents/orchestrator/stream \
  -X POST -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Hello from curl"}]}'
# → SSE stream with text-delta events

# Open browser
open http://localhost:3001
# → Type in chat → should see Mercury respond
```

---

## Files to Review (PR #5)

```
runtime/
├── package.json                    # deps: @mastra/core, @mastra/libsql, @openrouter/ai-sdk-provider v2.5
├── tsconfig.json
├── .npmrc                          # legacy-peer-deps for mastra build
└── src/
    ├── lib/
    │   ├── config.ts               # MODELS const (mercury, vision, visionFallback), env validation
    │   └── schemas/                # ALL Zod schemas for structured output
    │       ├── triage.ts           # triageOutput, severity, priority, fileRef, chainOfThought
    │       ├── ticket.ts           # ticketCreate, ticketResponse, duplicateCheck
    │       └── wiki.ts            # wikiDocument, wikiChunk, wikiQueryResult
    ├── mastra/
    │   ├── index.ts                # Mastra instance (3 agents, 1 workflow, LibSQL storage)
    │   ├── agents/                 # orchestrator, triage-agent, resolution-reviewer
    │   ├── tools/                  # 9 tool stubs with Zod I/O schemas
    │   └── workflows/              # triage-workflow (8 steps, suspend/resume)
.env.example                        # Updated with all 41 vars
```

Questions? Ping me on Matrix or Linear.

— Lalo
