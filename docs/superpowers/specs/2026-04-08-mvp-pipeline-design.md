# MVP Pipeline Design — Triage SRE Agent

**Date:** 2026-04-08  
**Authors:** Lalo, Koki
**Session:** planning  
**Status:** Approved for implementation

---

## 1. Scope

Complete the minimum viable end-to-end triage pipeline:

1. First-time onboarding (Linear token + GitHub repo → wiki)
2. Input processing layer (images via Gemma 4, PDFs via OpenRouter)
3. Orchestrator triage → TriageCard UI → user confirmation
4. Real `triageWorkflow` step implementations (replacing all stubs)
5. PR-based resolution verification with code-review-agent
6. Frontend: Kanban board + Settings page

**Out of scope for MVP:** Linear OAuth, parallel multi-issue triggering, wiki explorer UI, Graphify integration into the runtime pipeline.

---

## 2. Model Configuration

### Fallback chains

OpenRouter supports a `models` array in the request body — it tries each model in order if the previous fails/rate-limits. This is the native way to implement fallbacks.

**Orchestrator fallback chain:**

| Priority | Model ID | Notes |
|----------|----------|-------|
| 1 (primary) | `minimax/minimax-m2.7-20260318` | Flagship M2.7, strongest reasoning |
| 2 | `qwen/qwen3-235b-a22b:free` | Qwen3 235B free — substitute for MiMo V2 (not yet on OpenRouter) |
| 3 | `minimax/minimax-m2.5-20260211:free` | Only reached if M2.7 fails — NOT a general fallback |
| 4 (last resort) | `openrouter/auto` | OpenRouter free router — routes to best available free model |

**Sub-agents fallback chain (triage-agent, resolution-reviewer, code-review-agent):**

| Priority | Model ID | Notes |
|----------|----------|-------|
| 1 (primary) | `inception/mercury-2` | Fast, task-specific |
| 2 (last resort) | `openrouter/auto` | OpenRouter free router |

**Vision (processAttachments):**

| Priority | Model ID | Notes |
|----------|----------|-------|
| 1 (primary) | `google/gemma-4-31b-it:free` | Free multimodal vision |
| 2 (last resort) | `openrouter/auto` | OpenRouter free router |

### Updated `runtime/src/lib/config.ts`

```ts
export const MODELS = {
  // Sub-agents — fast, task-specific
  mercury: 'inception/mercury-2',

  // Orchestrator chain — highest reasoning capability
  orchestrator: 'minimax/minimax-m2.7-20260318',
  orchestratorFallback1: 'qwen/qwen3-235b-a22b:free',   // Qwen3 235B free (MiMo V2 when available)
  orchestratorFallback2: 'minimax/minimax-m2.5-20260211:free', // Only after M2.7 fails

  // Vision — multimodal for image processing
  vision: 'google/gemma-4-31b-it:free',
  visionFallback: 'google/gemma-4-31b-it',

  // Universal last resort — OpenRouter routes to best available free model
  freeRouter: 'openrouter/auto',
} as const;

// Fallback model arrays — pass as `models` param to OpenRouter
export const MODEL_CHAINS = {
  orchestrator: [
    MODELS.orchestrator,
    MODELS.orchestratorFallback1,
    MODELS.orchestratorFallback2,
    MODELS.freeRouter,
  ],
  subAgent: [MODELS.mercury, MODELS.freeRouter],
  vision: [MODELS.vision, MODELS.visionFallback, MODELS.freeRouter],
} as const;
```

### Implementation note

The `@openrouter/ai-sdk-provider` accepts a model ID string. To implement fallback chains, pass the `models` array via provider options or catch errors and retry with the next model. Example:

```ts
const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY });
// OpenRouter native fallback — pass models array in extraBody:
const orchestratorModel = openrouter(MODELS.orchestrator, {
  extraBody: { models: MODEL_CHAINS.orchestrator, route: 'fallback' },
});
```

---

## 3. First-time Onboarding

### Settings page (`/settings`)

Fields:
- **Linear API Token** — text input, validated by calling `GET /api/linear/members` on save. Badge: "Connected" / "Invalid token".
- **GitHub Repo URL** — text input (public repos only for MVP). Button: "Import & Generate Wiki".
- **Team Members** — "Sync from Linear" button → fetches and displays list with name + email.

### Wiki generation endpoint

`POST /api/wiki/generate` — new Hono route on the Mastra server:

1. Accept `{ repoUrl: string }` in request body
2. `git clone --depth 3 <repoUrl> /tmp/wiki-repo-<timestamp>`
3. Walk the cloned repo (ignore `node_modules`, `.git`, binary files)
4. For each file: call `generateWikiTool` with file content → LLM produces a structured summary (purpose, key functions, dependencies)
5. Chunk summaries → embed → store in LibSQL `wiki_chunks` table with DiskANN index
6. Update progress counter in a simple in-memory or LibSQL status row

`GET /api/wiki/status` — returns `{ total: number, processed: number, done: boolean }`.

Frontend polls every 2 seconds while wiki is generating; shows progress bar.

**Graphify (separate, demo only):** Run `graphify` CLI on the same cloned repo to produce `graph.html` for the interactive knowledge graph visualization in the demo video. Not part of the runtime query pipeline.

---

## 4. Input Processing Layer

### New tool: `processAttachmentsTool`

**File:** `runtime/src/mastra/tools/attachments.ts`  
**Tool ID:** `process-attachments`

```
Input: {
  files: Array<{ type: 'image' | 'pdf' | 'text', content: string, mimeType: string }>
  originalText: string
}

Output: {
  enrichedDescription: string  // originalText + "\n\n[ATTACHMENTS]\n" + descriptions
}
```

**Images (PNG, JPG, GIF, WEBP):**
- Call `generateText` with Gemma 4 31B free via OpenRouter
- Pass image as base64 content part (AI SDK `image` part type)
- Prompt: "Describe this screenshot in detail for an SRE incident report. Focus on error messages, stack traces, UI states, metric anomalies."

**PDFs:**
- Call OpenRouter `/api/v1/chat/completions` with content part `type: "file"`, `file_data` as `data:application/pdf;base64,{encoded}`
- Use `plugins: [{ id: "file-parser", pdf: { engine: "cloudflare-ai" } }]` (free engine)
- Model: any capable model (use `google/gemma-4-31b-it:free` for consistency)
- Prompt: "Extract all relevant technical information from this document for an SRE incident report."

**Text / logs / markdown:**
- Pass through directly, no transformation

Register `processAttachmentsTool` on the orchestrator.

---

## 5. Orchestrator Flow

The orchestrator (`/chat` → `POST /chat`) receives messages including file parts. Updated system prompt:

1. If files are attached → call `process-attachments` tool → get `enrichedDescription`
2. Call `query-wiki` with key terms from enrichedDescription → get code context
3. Analyze: identify severity, root cause, affected files, proposed fix
4. Call `display-triage` tool → renders `TriageCard` in `pending` state in the frontend

### New tool: `displayTriageTool`

**File:** `runtime/src/mastra/tools/display-triage.ts`  
**Tool ID:** `displayTriage` (must match `toolComponents` key in `tool-registry.tsx`)

```
Input: {
  title: string
  severity: 'Critical' | 'High' | 'Medium' | 'Low'
  confidence: number          // 0-100 (percentage for display)
  summary: string
  rootCause: string
  fileReferences: Array<{ filePath: string; lineNumber?: number }>
  proposedFix?: string
  enrichedDescription: string // passed through to workflow trigger
  reporterEmail?: string
}

Output: same as Input (render tool — returns data for UI)
```

The `execute` function simply returns the input as output (the tool exists to produce a structured tool-call that the frontend renders as a `TriageCard`).

### Frontend: wiring `onCreateTicket`

In `chat.tsx`, detect `displayTriage` tool parts and inject `onCreateTicket`:

```tsx
if (part.type === 'tool-displayTriage' && toolPart.state === 'output-available') {
  return (
    <TriageCard
      {...toolPart.output}
      onCreateTicket={() => triggerWorkflow(toolPart.output)}
    />
  )
}
```

`triggerWorkflow` calls `POST /api/workflows/triage-workflow/trigger` with the card data.

---

## 6. Triage Workflow — Real Implementations

All 8 steps replaced with real logic. Steps access tools via direct imports (not via agent tool registration — workflow steps call tool `execute` functions directly).

### Step 1: `intake`

Receives `{ enrichedDescription, reporterEmail, repository }` — already processed by orchestrator.
Validates inputs, normalizes text. No LLM call needed.

### Step 2: `triage`

```ts
const result = await triageAgent.generate([
  { role: 'user', content: `${enrichedDescription}\n\nCodebase context:\n${wikiContext}` }
]);
// parse structured output (triageOutputSchema)
```

Returns: `{ severity, confidence, rootCause, summary, fileReferences, suggestedActions }`.

### Step 3: `dedup`

**Note:** The primary dedup UX happens at the **orchestrator level** (before the user confirms and triggers the workflow). The orchestrator calls `searchLinearIssues`, computes similarity, and shows either `displayDuplicate` or `displayTriage` tool output. The workflow's dedup step is a safety net only.

**At orchestrator level (before TriageCard):**
```ts
// Orchestrator calls searchLinearIssues, then:
if (similarity > 0.85) {
  // Call displayDuplicate tool → shows DuplicatePrompt, "Update Existing" as primary
} else if (similarity > 0.7) {
  // Call displayDuplicate tool → shows DuplicatePrompt, "Create New" as primary (warning only)
} else {
  // Call displayTriage tool → shows TriageCard normally
}
```

**In workflow dedup step (safety net):**
```ts
const searchResult = await searchLinearIssues.execute({
  query: rootCause.slice(0, 150),
  teamId: LINEAR_CONSTANTS.TEAM_ID,
  limit: 5
});
const topMatch = findBestMatch(rootCause, searchResult.issues);
// Only auto-block at very high confidence (> 0.9) — user already confirmed at orchestrator level
```

**New tool needed:** `displayDuplicateTool` with `id: 'displayDuplicate'` (matches tool-registry key). Same pattern as `displayTriageTool` — returns data that the frontend renders as `DuplicatePrompt`.

### Step 4: `ticket`

```ts
if (isDuplicate && existingIssueId) {
  // Update existing issue with new context comment
  await updateLinearIssue.execute({ issueId: existingIssueId, description: updatedBody });
} else {
  // Create new issue
  await createLinearIssue.execute({
    teamId: LINEAR_CONSTANTS.TEAM_ID,
    title: `[${severity}] ${summary.slice(0, 120)}`,
    description: formatTriageSummaryMarkdown(triageData),
    priority: severityToPriority(severity),  // Critical→1, High→2, Medium→3, Low→4
    stateId: LINEAR_CONSTANTS.STATES.TRIAGE,
    labelIds: [LINEAR_CONSTANTS.SEVERITY_LABELS[severity.toUpperCase()]],
    assigneeId: pickAssignee(LINEAR_CONSTANTS.MEMBERS),  // round-robin or on-call
  });
}
```

### Step 5: `notify`

```ts
await sendTicketNotification.execute({
  to: assigneeEmail,
  ticketTitle: issueTitle,
  severity,
  priority: severityToPriority(severity),
  summary: triageSummary,
  linearUrl: issueUrl,
  assigneeName: assigneeName,
  linearIssueId: issueId,
});
```

### Step 6: `suspend`

Already implemented. Waits for Linear webhook. No changes.

### Step 7: `verify` — PR-based resolution

After workflow resumes from suspend (Linear webhook: ticket → Done):

1. `getLinearIssue(issueId)` → fetch issue with attachments to find linked GitHub PR URL
2. If **no PR linked:**
   - `updateLinearIssue({ stateId: LINEAR_CONSTANTS.STATES.IN_REVIEW })`
   - `sendTicketNotification({ to: assigneeEmail, message: "Please link a PR to verify this fix" })`
   - Return `verdict: 'unresolved'`
3. If **PR linked:**
   - `resolution-reviewer.generate()` with original rootCause + PR URL
   - `code-review-agent.generate()` with PR diff
   - If code-review-agent finds critical/major issues:
     - Post comment on PR via `commentOnGitHubPR` tool (see §7)
     - `updateLinearIssue({ stateId: LINEAR_CONSTANTS.STATES.IN_REVIEW })`
     - `sendTicketNotification({ to: assigneeEmail, message: reviewNotes })`
     - Return `verdict: 'partially_resolved'`
   - If resolution-reviewer confirms fix addresses rootCause:
     - If code-review-agent found no issues → no PR comment posted
     - Return `verdict: 'resolved'`

### Step 8: `notify-resolution`

```ts
await sendResolutionNotification.execute({
  to: reporterEmail,
  originalTitle: issueTitle,
  resolutionSummary: verificationNotes,
  prLink: prUrl,
  linearUrl: issueUrl,
  linearIssueId: issueId,
});
```

---

## 7. GitHub PR Comment Tool

**File:** `runtime/src/mastra/tools/github.ts`  
**Tool ID:** `comment-on-github-pr`

Posts a code-review comment on a GitHub PR using the GitHub REST API.

```
Input: {
  prUrl: string   // e.g. https://github.com/org/repo/pull/123
  body: string    // markdown comment body
}
Output: { success: boolean, commentUrl?: string, error?: string }
```

`GITHUB_TOKEN` is read from `process.env.GITHUB_TOKEN` inside the tool's execute function — NOT passed as tool input (would expose it in LLM context).

Requires new env var: `GITHUB_TOKEN` (personal access token with `repo` scope).

Comment body format:
```md
## Triage Code Review

**Verdict:** [approve | request-changes | comment-only]

[review comments here]

---
_Generated by Triage Resolution Reviewer_
```

If `verdict === 'approve'` (no issues found): **do not post** a comment. Only post when there are issues to flag.

---

## 8. Frontend: Kanban Board

### New runtime endpoint: `GET /api/linear/issues`

Hono route in Mastra server:
- Calls `linearClient.issues({ filter: { team: { id: { eq: LINEAR_CONSTANTS.TEAM_ID } } }, first: 50 })`
- Groups by `state.name`
- Returns `{ backlog: Issue[], todo: Issue[], inProgress: Issue[], inReview: Issue[], done: Issue[] }`

### `board.lazy.tsx` update

- TanStack Query: `useQuery({ queryKey: ['linear-issues'], queryFn: () => apiFetch('/api/linear/issues'), refetchInterval: 30_000 })`
- Render each column with real issue cards
- Issue card: title, severity label badge, assignee initials avatar, Linear URL link

---

## 9. Frontend: Settings Page

### New runtime endpoints

- `GET /api/linear/members` — proxies `getLinearTeamMembers` for the configured team
- `POST /api/wiki/generate` — triggers wiki generation (see §3)
- `GET /api/wiki/status` — returns generation progress

### `settings.lazy.tsx` update

Three sections:
1. **Integrations** — Linear token input + validation badge, GitHub repo URL input + "Generate Wiki" button
2. **Wiki** — progress bar (polling `/api/wiki/status`), "last generated" timestamp, file count
3. **Team Members** — "Sync from Linear" button + member list (name, email, displayName)

---

## 10. Multiple Issues (MVP vs Stretch)

**MVP (one at a time):**
- Orchestrator detects single incident in user message
- Generates one `TriageCard`
- User confirms → one workflow trigger

**Stretch goal (parallel batch):**
- Orchestrator detects batch ("multiple issues mentioned")
- Calls `display-triage` multiple times → multiple `TriageCard`s in chat
- Each "Create Ticket" button triggers its own independent workflow run
- `Promise.all()` of multiple `POST /api/workflows/triage-workflow/trigger` calls

---

## 11. Dedup Similarity (MVP Implementation)

For MVP, use keyword overlap ratio (no embeddings needed for dedup):

```ts
function computeSimilarity(rootCause: string, issueTitle: string): number {
  const a = new Set(rootCause.toLowerCase().split(/\W+/).filter(w => w.length > 3));
  const b = new Set(issueTitle.toLowerCase().split(/\W+/).filter(w => w.length > 3));
  const intersection = [...a].filter(w => b.has(w)).length;
  return intersection / Math.max(a.size, b.size, 1);
}
```

Thresholds:
- `> 0.85` → auto-assume duplicate. Show `DuplicatePrompt` with "Update Existing" as primary action.
- `> 0.7` → warn user. Show `DuplicatePrompt` with "Create New" as primary, "Update Existing" as secondary.
- `≤ 0.7` → proceed as new issue.

---

## 12. Security / Env Vars

New env vars to add to `.env.example`:
```bash
GITHUB_TOKEN=          # GitHub PAT with repo scope — for PR commenting
MINIMAX_API_KEY=       # Only needed if Minimax requires separate key (check OpenRouter)
```

Note: Minimax via OpenRouter uses `OPENROUTER_API_KEY` — no separate key needed.

---

## 13. Wire-Up Summary

| What | Where | Status |
|------|-------|--------|
| MODELS.orchestrator = minimax-m2.5 | `runtime/src/lib/config.ts` | TODO |
| `processAttachmentsTool` | `runtime/src/mastra/tools/attachments.ts` | TODO |
| `displayTriageTool` | `runtime/src/mastra/tools/display-triage.ts` | TODO |
| `commentOnGitHubPRTool` | `runtime/src/mastra/tools/github.ts` | TODO |
| Update orchestrator (model + tools) | `runtime/src/mastra/agents/orchestrator.ts` | TODO |
| Wire all 8 workflow steps | `runtime/src/mastra/workflows/triage-workflow.ts` | TODO |
| Hono routes: /api/linear/issues, /api/linear/members, /api/wiki/generate, /api/wiki/status | `runtime/src/mastra/index.ts` | TODO |
| Workflow trigger endpoint | Mastra v1.24 exposes `POST /api/workflows/:id/trigger` by default — verify at runtime startup; if not present, add custom Hono route that calls `mastra.getWorkflow('triage-workflow').createRun().start(input)` | TODO |
| `onCreateTicket` in chat.tsx | `frontend/src/routes/chat.tsx` | TODO |
| Kanban data in board.lazy.tsx | `frontend/src/routes/board.lazy.tsx` | TODO |
| Settings page | `frontend/src/routes/settings.lazy.tsx` | TODO |
