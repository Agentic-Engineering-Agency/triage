# Handoff: PR Readiness — fe/linear-runtime-frontend-integration → dev

**From:** Fernando (infra/platform lead)
**To:** Implementing session (Hermes agent)
**Date:** 2026-04-09
**Branch:** `fe/linear-runtime-frontend-integration` (commit `57035b7`)
**Target:** `origin/dev` (commit `8684a24`)
**Worktree:** `~/hackathon/triage-fe-linear-runtime-frontend-integration/`

---

## Mission

Fix all bugs in this branch, verify the full stack works end-to-end (both backend and frontend), then open a clean PR against `dev`. The branch contains Lalo's MVP pipeline implementation — runtime agents, tools, triage workflow, API endpoints, and frontend wiring (chat, board, settings pages). Dev already has infra + observability merged.

**Scope is strictly this worktree.** Do not touch other worktrees. Do not merge other branches. Better Auth is being handled separately.

---

## Docker — How to Run

All 9 containers are already running from this worktree. **Always use production compose** (no override):

```bash
cd ~/hackathon/triage-fe-linear-runtime-frontend-integration
docker compose -f docker-compose.yml up -d --build
```

The `docker-compose.override.yml` is broken (vite container missing node_modules, runtime tsx watch targets nonexistent file). **Do NOT use it.** Document "use `-f docker-compose.yml`" in the PR description instead of fixing the override.

### Current container health (verified):
| Service | Port | Status |
|---------|------|--------|
| frontend (Caddy) | :3001 | healthy, 200 OK |
| runtime (Mastra/Hono) | :4111 | healthy, `{"success":true}` |
| libsql | :8080 | healthy |
| langfuse-web | :3000 | starting (slow, takes ~2min) |
| langfuse-worker | :3030 | starting |
| clickhouse | :8123 | healthy |
| postgres | :5432 | healthy |
| minio | :9090 | healthy |
| redis | :6379 | healthy |

### Routing chain (verified):
- Frontend serves SPA at `:3001`, fetches `/config.json` → `{"apiUrl": "/api"}`
- `apiFetch('/linear/issues')` → resolves to `/api/linear/issues` → Caddy proxies to `runtime:4111/api/linear/issues` ✅
- Chat transport uses `api: "/chat"` → `POST /chat` → Caddy `@chat_post` matcher → `runtime:4111/chat` ✅
- SSE streaming works via `flush_interval -1` in Caddyfile

---

## Bug #1 (CRITICAL) — Orchestrator Model Chain Crashes Every Request

**Symptom:** Every chat message returns:
```
AI_APICallError: 'models' array must have 3 items or fewer.
```

**Root cause:** `MODEL_CHAINS.orchestrator` in `runtime/src/lib/config.ts` line 92 has 4 models. OpenRouter's `route: "fallback"` API allows **max 3**.

**Fix:** Replace the orchestrator chain and update the MODELS object:

In `runtime/src/lib/config.ts`:

1. Replace the `orchestratorFallback1` entry (qwen3-235b) with Qwen 3.6 Plus:
```ts
/** qwen/qwen3.6-plus:free — orchestrator fallback 1 */
orchestratorFallback1: 'qwen/qwen3.6-plus:free',
```

2. Remove `orchestratorFallback2` (minimax M2.5) entirely from the `MODELS` object.

3. Update `MODEL_CHAINS.orchestrator` to exactly 3 entries:
```ts
orchestrator: [MODELS.orchestrator, MODELS.orchestratorFallback1, MODELS.freeRouter],
```

This gives us: minimax M2.7 → qwen 3.6 plus (free) → openrouter/auto.

**Verify after fix:**
```bash
# Rebuild runtime container
cd ~/hackathon/triage-fe-linear-runtime-frontend-integration
docker compose -f docker-compose.yml up -d --build runtime

# Wait for healthy
docker ps --filter name=runtime --format '{{.Status}}'

# Test — should see text-delta events, NOT errors
curl -s --max-time 10 -N http://127.0.0.1:4111/api/agents/orchestrator/stream \
  -X POST -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"Hello, what can you do?"}]}' | head -5
```

Expected: SSE events with `type: "text-delta"` containing actual text.

---

## Bug #2 — Frontend TS Build Error (chat.tsx)

**Symptom:** `docker compose build frontend` fails:
```
error TS2741: Property 'state' is missing in type '{ onCreateTicket: () => Promise<void>; }'
  but required in type 'TriageCardProps'.
```

**Root cause:** `frontend/src/routes/chat.tsx` line ~396 spreads `output` (typed as `Record<string, unknown>`) into `<TriageCard>` but TS can't verify the required `state` prop exists.

**Fix:** Already applied in the worktree but needs to be committed. The line should be:
```tsx
<TriageCard
  {...(output as unknown as import("@/components/triage-card").TriageCardProps)}
  onCreateTicket={() => handleCreateTicket(output)}
/>
```

**Verify:** `docker compose -f docker-compose.yml build frontend` succeeds.

---

## Verification Checklist (all must pass before PR)

### Backend Verification

1. **Orchestrator chat E2E** (after Bug #1 fix):
```bash
curl -s --max-time 15 -N http://127.0.0.1:4111/api/agents/orchestrator/stream \
  -X POST -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"Hello, what can you do?"}]}' | head -10
```
✅ Must return `text-delta` events with actual text content.

2. **Linear issues endpoint**:
```bash
curl -s http://127.0.0.1:4111/api/linear/issues | python3 -m json.tool | head -20
```
✅ Must return `{"success":true,"data":{...}}` with grouped issues (already works, verified).

3. **Linear members endpoint**:
```bash
curl -s http://127.0.0.1:4111/api/linear/members | python3 -m json.tool
```
✅ Must return team members array.

4. **Wiki status endpoint** (stub):
```bash
curl -s http://127.0.0.1:4111/api/wiki/status
```
✅ Must return `{"success":true,"data":{"total":0,"processed":0,"done":true}}`.

5. **Webhook endpoint** (stub):
```bash
curl -s -X POST http://127.0.0.1:4111/api/webhooks/linear \
  -H 'Content-Type: application/json' -d '{"action":"test"}'
```
✅ Must return `{"success":true,"data":{"received":true}}`.

6. **Workflow trigger endpoint**:
```bash
curl -s -X POST http://127.0.0.1:4111/api/workflows/triage-workflow/trigger \
  -H 'Content-Type: application/json' \
  -d '{"description":"Test incident","reporterEmail":"test@test.com"}'
```
✅ Must return `{"success":true,"data":{"runId":"...","status":"started"}}`.

7. **Runtime health**:
```bash
curl -s http://127.0.0.1:4111/health
```
✅ Must return `{"success":true}`.

### Frontend Verification (through Caddy at :3001)

8. **Chat page** — open `http://localhost:3001/chat`:
   - Type "Hello" → should see streaming text response from orchestrator
   - Describe a mock incident → should eventually see TriageCard or text response
   - Check browser console for JS errors

9. **Board page** — open `http://localhost:3001/board`:
   - Should render Kanban columns (Triage, Backlog, Todo, In Progress, In Review, Done)
   - Issues should populate from Linear API
   - If LINEAR_API_KEY is missing, should show error gracefully (not crash)

10. **Settings page** — open `http://localhost:3001/settings`:
    - Team members section should list Linear team members
    - Wiki generation form should be present
    - Token validation UI should work

11. **Routing through Caddy** — verify all these return 200:
```bash
curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3001/           # SPA
curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3001/chat       # SPA route
curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3001/board      # SPA route
curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3001/settings   # SPA route
curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3001/config.json # Config
curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3001/health     # Proxy
```

---

## Code Quality Pass

After bugs are fixed and verification passes, do a quality sweep:

### Check 1: No `any` leakage in new files
```bash
grep -rn ': any' runtime/src/mastra/tools/attachments.ts \
  runtime/src/mastra/tools/display-triage.ts \
  runtime/src/mastra/tools/display-duplicate.ts \
  runtime/src/mastra/tools/github.ts \
  runtime/src/mastra/agents/orchestrator.ts
```
The `callTool` helper in `triage-workflow.ts` (line 22) uses `any` intentionally — that's acceptable, documented with eslint-disable comment. But new tool files should not have stray `any`.

### Check 2: Error response consistency
All API route handlers in `runtime/src/mastra/index.ts` must follow:
- Success: `{ success: true, data: T }`
- Error: `{ success: false, error: { code: string, message: string } }`

### Check 3: Schema barrel completeness
Verify `runtime/src/lib/schemas/index.ts` exports from all schema files: `triage.ts`, `ticket.ts`, `wiki.ts`, `attachments.ts`, `display.ts`, `github.ts`, `review.ts`.

### Check 4: Known TODOs (acceptable for MVP, document in PR)
- `runtime/src/mastra/index.ts:116` — `// TODO: Implement full wiki generation` (git clone + file walk)
- `runtime/src/mastra/index.ts:150` — `// TODO: Look up suspended workflow run by issueId and resume it`
- `frontend/src/hooks/use-auth.ts` — Stub, auth handled in separate worktree

### Check 5: callTool helper signature
In `runtime/src/mastra/workflows/triage-workflow.ts` line 24:
```ts
return tool.execute({ context: input }, {});
```
Mastra's `createTool` execute function receives `(inputData, executionContext)`. The `{ context: input }` wrapper pattern was used in Koki's tool implementations where tools do `input?.context ?? input` internally. Verify this actually works by checking that the workflow trigger endpoint doesn't error when calling tool steps. If it fails, the fix is to change to `tool.execute(input, {})`.

---

## Commit Strategy

Make incremental, logically-separated commits:

1. `fix(runtime): update orchestrator model chain — M2.7 → Qwen 3.6 Plus → auto (OpenRouter 3-model limit)`
2. `fix(frontend): type-safe TriageCard spread in chat.tsx`
3. Any additional fixes discovered during verification (one commit per fix, descriptive message)
4. `chore: pre-PR cleanup` (if any stray changes remain)

**Do NOT bulk-commit everything at the end.** Each fix gets its own commit with a clear message.

---

## PR Description Template

Title: `feat: MVP pipeline — orchestrator, triage workflow, frontend wiring`

Body should include:
- **What**: Full triage pipeline (8-step workflow), orchestrator agent with 11 tools, 5 custom API endpoints, frontend chat/board/settings pages
- **Architecture**: Orchestrator → tools (Linear, Resend, wiki, display, attachments, GitHub) → triageWorkflow (intake→triage→dedup→ticket→notify→suspend→verify→notify-resolution)
- **Known limitations**: Wiki generation is a stub, webhook resume is a stub, auth is a stub (separate PR)
- **How to test**: `docker compose -f docker-compose.yml up -d --build`, then open `http://localhost:3001/chat`
- **Note**: Use `-f docker-compose.yml` explicitly — the override file is not functional

---

## Architecture Reference

```
Frontend (Caddy :3001)
├── /chat          → POST /chat → runtime:4111/chat (SSE stream)
├── /board         → GET /api/linear/issues → runtime:4111/api/linear/issues
├── /settings      → GET /api/linear/members, POST /api/wiki/generate
└── /config.json   → {"apiUrl": "/api"}

Runtime (Mastra/Hono :4111)
├── Agents
│   ├── orchestrator (minimax M2.7 + fallback chain, 11 tools)
│   ├── triage-agent (Mercury, queryWiki tool)
│   ├── resolution-reviewer (Mercury, queryWiki + getLinearIssue)
│   └── code-review-agent (Mercury, queryWiki)
├── Tools (13 total)
│   ├── Linear: createLinearIssue, updateLinearIssue, getLinearIssue, listLinearIssues, getTeamMembers
│   ├── Resend: sendTicketEmail, sendResolutionEmail
│   ├── Wiki: queryWiki, generateWiki
│   ├── Display: displayTriage, displayDuplicate (passthrough → frontend components)
│   ├── Attachments: processAttachments (images via Gemma 4 vision, PDFs via OpenRouter file-parser)
│   └── GitHub: commentOnGitHubPR
├── Workflows
│   └── triage-workflow (8 steps: intake→triage→dedup→ticket→notify→suspend→verify→notify-resolution)
├── API Routes (custom Hono)
│   ├── GET  /api/linear/issues
│   ├── GET  /api/linear/members
│   ├── POST /api/wiki/generate (stub)
│   ├── GET  /api/wiki/status (stub)
│   ├── POST /api/webhooks/linear (stub)
│   └── POST /api/workflows/triage-workflow/trigger
└── Storage: LibSQL (libsql:8080)

Langfuse (6 containers, observability)
├── langfuse-web :3000
├── langfuse-worker :3030
├── clickhouse :8123
├── postgres :5432
├── minio :9090
└── redis :6379
```

---

## File Map — What Changed vs dev (32 files)

### Runtime (backend)
| File | What |
|------|------|
| `runtime/src/lib/config.ts` | **BUG HERE** — Model chains + env validation + LINEAR_CONSTANTS |
| `runtime/src/lib/schemas/index.ts` | Barrel exports for all schemas |
| `runtime/src/lib/schemas/attachments.ts` | New — Zod schemas for attachment processing |
| `runtime/src/lib/schemas/display.ts` | New — Zod schemas for displayTriage/displayDuplicate |
| `runtime/src/lib/schemas/github.ts` | New — Zod schemas for GitHub PR comment tool |
| `runtime/src/mastra/agents/orchestrator.ts` | Full orchestrator with system prompt, 11 tools, fallback chain |
| `runtime/src/mastra/index.ts` | Mastra instance + 5 custom API routes |
| `runtime/src/mastra/tools/index.ts` | Barrel exports — adds 4 new tools |
| `runtime/src/mastra/tools/attachments.ts` | New — process-attachments (vision + PDF parser) |
| `runtime/src/mastra/tools/display-triage.ts` | New — passthrough render tool for TriageCard |
| `runtime/src/mastra/tools/display-duplicate.ts` | New — passthrough render tool for DuplicatePrompt |
| `runtime/src/mastra/tools/github.ts` | New — comment-on-github-pr tool |
| `runtime/src/mastra/workflows/triage-workflow.ts` | Complete 8-step pipeline (was all stubs before) |
| `runtime/package.json` | Added `ai` dependency |

### Frontend
| File | What |
|------|------|
| `frontend/src/routes/chat.tsx` | **BUG HERE** — Tool rendering (TriageCard, DuplicatePrompt), onCreateTicket |
| `frontend/src/routes/board.lazy.tsx` | Kanban board with TanStack Query → /api/linear/issues |
| `frontend/src/routes/settings.lazy.tsx` | Linear token, wiki generation, team member sync |
| `frontend/src/components/tool-registry.tsx` | Minor fix |

### Config / Infra
| File | What |
|------|------|
| `.env.example` | Added GITHUB_TOKEN, BETTER_AUTH vars |
| `.gitignore` | Minor addition |
| `PROJECT_STATE.md` | Removed stale line |

### Removed (existed on dev, not on this branch's base)
| File | Why |
|------|-----|
| `docs/handoff-LANGFUSE-OBSERVABILITY-2026-04-09.md` | Observability spec — merged to dev separately |
| `specs/active/SPEC-20260408-003.md` | Same |
| `tests/infra-observability/langfuse-observability.test.ts` | Same |

---

## .env — Required Keys

The `.env` file is already populated in the worktree. Critical keys:
- `OPENROUTER_API_KEY` — **required**, runtime crashes without it
- `LINEAR_API_KEY` — needed for board/settings pages and triage workflow
- `GITHUB_TOKEN` — needed for PR comment tool (optional)
- `RESEND_API_KEY` — needed for email notifications (graceful degradation if missing)

---

## Key Conventions

- **Files**: kebab-case (`display-triage.ts`, `triage-workflow.ts`)
- **Tool IDs**: camelCase for display tools (`displayTriage`, `displayDuplicate` — must match `tool-registry.tsx` keys), kebab-case for backend tools
- **Schemas**: All in `runtime/src/lib/schemas/` by domain, never inline
- **API responses**: `{ success: true, data: T }` or `{ success: false, error: { code, message } }`
- **Error handling**: tool-level try/catch, graceful degradation, never crash the server
- **Barrel exports**: Only in `src/mastra/{agents,tools,workflows}/index.ts`
- **No `any`**: Use `z.infer<>`, `unknown` + narrowing, or SDK types. Only exception is the `callTool` workflow helper (documented)

---

## Success Criteria

The PR is ready when:
1. ✅ `docker compose -f docker-compose.yml up -d --build` succeeds (both images build)
2. ✅ Runtime health check passes
3. ✅ Orchestrator chat returns streaming text (not errors)
4. ✅ All 5 API endpoints return valid responses
5. ✅ Frontend chat page works E2E (type → stream → render)
6. ✅ Frontend board page renders Kanban with Linear issues
7. ✅ Frontend settings page renders team members
8. ✅ No TS build errors in either frontend or runtime
9. ✅ Incremental commits with descriptive messages
10. ✅ PR opened against `dev` with description covering what/why/limitations
