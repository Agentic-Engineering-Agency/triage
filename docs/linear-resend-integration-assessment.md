# Linear & Resend Integration — Technical Assessment

**Date:** 2026-04-08
**Author:** Koki (Coqui) — Runtime/Integrations
**Branch:** `feature/linear-and-resend-integration`
**Worktree:** `/Users/agent/triage-feature-linear-and-resend-integration`

---

## 1. Current Project State

### What Exists
- **Frontend** (19/impl branch): Full scaffold — TanStack Router, shadcn/ui, chat route, board route, triage-card, severity-badge, confidence-score, file-reference, chain-of-thought-step, kanban components. All UI primitives ready.
- **Infrastructure** (main): Docker Compose with 9 containers, Caddyfile, K8s scaffolds, CI.
- **Runtime**: NOT scaffolded yet. The `feature/mastra-runtime` branch is empty (just main merge). No `runtime/` directory exists on any branch.

### What This Means for Integration Scope
The Linear and Resend tools need to be designed as **standalone Mastra tool modules** that will be imported by the runtime when it's scaffolded. Since the runtime doesn't exist yet, we should:
1. Define the tools as self-contained TypeScript modules with clear interfaces
2. Define the Zod schemas they depend on
3. Define the config/env validation they require
4. Make them testable independently (unit tests with mocked APIs)

---

## 2. Linear Integration — SDK vs MCP Assessment

### Option A: `@linear/sdk` (Direct SDK — RECOMMENDED)

**What it is:** Official TypeScript SDK wrapping Linear's GraphQL API. Strongly typed models and operations.

**Capabilities (confirmed from docs):**
| Operation | SDK Method | Notes |
|-----------|-----------|-------|
| Create issue | `linearClient.createIssue({ teamId, title, description, priority, assigneeId, labelIds, stateId })` | Returns `{ success, issue }` |
| Update issue | `linearClient.updateIssue(id, { title, stateId, ... })` or `issue.update({...})` | Model-level mutation |
| Get issue | `linearClient.issue(id)` | Supports shorthand IDs like `TRI-123` |
| List/search issues | `linearClient.issues({ filter: {...}, first, after, orderBy })` | Rich filtering: by assignee, label, state, priority, date ranges, `contains`, `or` |
| Get team | `linearClient.team(id)` | |
| List teams | `linearClient.teams()` | Returns nodes with id, name |
| Get team members | `team.members()` | Returns User nodes |
| List labels | `linearClient.issueLabels()` or `team.labels()` | |
| Create comment | `linearClient.createComment({ issueId, body })` | Markdown supported |
| List workflow states | `team.states()` | Get Triage, Backlog, In Progress, Done, etc. |
| Webhooks | GraphQL mutation `webhookCreate` | Requires admin scope; programmatic creation |
| Pagination | `issues.fetchNext()`, `issues.pageInfo.hasNextPage` | Relay cursor-based |

**Error handling:**
- SDK throws typed errors: `InvalidInputLinearError`, `LinearError`
- Errors include `status`, `data`, `query`, `variables`, parsed `errors[]` array
- Each error has `.type` (LinearErrorType), `.userError`, `.message`, `.path`

**Rate limits:**
- 5,000 requests/hour per user (API key)
- 3,000,000 complexity points/hour
- Max 10,000 complexity per single query
- Leaky bucket algorithm, headers expose remaining quota

**Authentication:** Personal API key — `Authorization: <API_KEY>` (no Bearer prefix). Simple, works in Docker containers, no browser needed.

**Advantages for our use case:**
1. FULL CRUD control — every GraphQL field exposed as typed operation
2. Custom error boundaries — we wrap in try/catch, return `{success, data}` or `{success: false, error}`
3. Programmatic webhook creation — can auto-register Linear webhooks from our runtime
4. Fine-grained filtering — duplicate detection via `issues({ filter: { title: { containsIgnoreCase: "..." }}})` 
5. Label management — create/assign severity labels (Critical/High/Medium/Low) programmatically
6. State management — move issues through workflow states (Triage → In Progress → Done)
7. No external dependency beyond `@linear/sdk` — runs in Docker with just an API key
8. Testable — mock the LinearClient in tests, no MCP server to spin up
9. Zod schema validation on inputs/outputs — we control the contract completely
10. Works offline/air-gapped — no remote MCP server dependency

### Option B: Official Linear MCP Server (`mcp.linear.app/mcp`)

**What it is:** Remote MCP server hosted by Linear. 21 tools accessible via Streamable HTTP + OAuth 2.1.

**Available tools (21):**
- `list_issues`, `get_issue`, `create_issue`, `update_issue`, `list_my_issues`
- `list_projects`, `get_project`, `create_project`, `update_project`
- `list_teams`, `get_team`, `list_users`, `get_user`
- `list_comments`, `create_comment`
- `list_issue_statuses`, `get_issue_status`, `list_issue_labels`
- `get_document`, `list_documents`, `search_documentation`

**Authentication:** OAuth 2.1 with dynamic client registration. BUT docs confirm API keys also work via `Authorization: Bearer <yourtoken>` header.

**Mastra integration:** Via `MCPClient`:
```typescript
const linearMcp = new MCPClient({
  servers: {
    linear: {
      url: new URL('https://mcp.linear.app/mcp'),
      requestInit: {
        headers: { Authorization: `Bearer ${process.env.LINEAR_API_KEY}` }
      }
    }
  }
})
// Then: tools: await linearMcp.listTools()
```

**CRITICAL LIMITATIONS for our use case:**

1. **No webhook creation tool** — The MCP has 21 tools but NONE for creating/managing webhooks. Our resolution flow requires programmatic webhook registration (`webhookCreate` mutation). We'd need the SDK anyway for this.

2. **No label creation** — `list_issue_labels` is read-only. We need to CREATE severity labels (Critical/High/Medium/Low) if they don't exist. SDK required.

3. **No workflow state transitions** — `list_issue_statuses` / `get_issue_status` are read-only. To move an issue from Triage → In Progress, we'd need `update_issue` with a `stateId`, which the MCP `update_issue` tool might support — but its input schema is opaque to us.

4. **No custom error handling** — MCP tools return `CallToolResult` with `isError`/`content`/`structuredContent`. We can't control the error format or add our `{success, data/error}` pattern. The Mastra MCP client had a recent bug (#10430) where `structuredContent` parsing broke — fragile surface area.

5. **Remote dependency** — The server is at `mcp.linear.app`. If Linear's MCP endpoint is down during our hackathon demo, all Linear operations fail. No local fallback path. With the SDK, we can catch errors and fall back to local DB tickets.

6. **Network latency** — Every tool call goes: Runtime → Internet → mcp.linear.app → Linear GraphQL → back. With the SDK it's: Runtime → Linear GraphQL API directly. One fewer hop.

7. **Schema opacity** — We don't control the input/output Zod schemas. Whatever the MCP server defines is what we get. Can't add custom fields, can't validate our TriageOutput against a known contract before sending to Linear.

8. **Docker container compatibility** — OAuth 2.1 with browser-based auth flow is designed for interactive clients (Claude Desktop, Cursor). In a headless Docker container, we'd need the API key header approach — which works but is undocumented behavior, not the primary auth flow.

9. **21 tools is a LOT** — When attached to an agent via `listTools()`, all 21 tools go into the agent's tool registry. This increases token usage (tool descriptions in system prompt) and makes tool selection noisier. With custom tools, we define exactly the 5 tools we need.

10. **No `toModelOutput` control** — Custom tools support `toModelOutput` to shape what the model sees vs what the app gets. MCP tools return their full output to the model always.

### Option C: Hybrid (MCP for reads, SDK for writes)

**Theoretically possible** but adds complexity:
- Two Linear clients to maintain (MCPClient + LinearClient)
- Two auth flows to configure
- Inconsistent error handling between MCP reads and SDK writes
- More surface area for bugs

**Verdict: NOT worth the complexity.**

### DECISION: Option A — `@linear/sdk` Direct

**Reasons:**
1. We need webhook creation (MCP doesn't have it)
2. We need label creation (MCP doesn't have it)
3. We need custom error boundaries matching our architecture pattern
4. We need to work reliably inside Docker containers
5. We need exactly 5 tools, not 21
6. We need Zod schema control for the Generative UI pipeline
7. We need graceful degradation (fallback to local tickets) — requires try/catch control
8. This matches the architecture doc: "Linear SDK as Mastra tools" (decided in planning)
9. Your teammate's suggestion of "programmatic CRUD tools" aligns perfectly with this

---

## 3. Resend Integration Assessment

### API Overview (confirmed from docs)

**Package:** `resend` (npm)
**Class:** `new Resend(apiKey)`
**Key method:** `resend.emails.send({ from, to, subject, html, ... })`

**Response pattern:**
```typescript
const { data, error } = await resend.emails.send({...})
// Success: { data: { id: string }, error: null }
// Failure: { data: null, error: { message: string, name: string } }
```

**IMPORTANT:** Resend does NOT throw on send failure — it returns `{ data, error }`. Only network-level failures throw. This means our tool error boundary wraps both:
- Network errors (try/catch) 
- API errors (check `error` field)

**Rate limits:** 5 requests/second per team. More than enough for our use case.

**Domain requirement:** The `from` address (`triage@agenticengineering.lat`) requires domain verification in Resend. DNS records (SPF, DKIM, DMARC) must be configured for `agenticengineering.lat`. Without verification, emails go to spam or are rejected.

**Key features for our tools:**
- `html` content — we'll render triage results as HTML email
- `tags` — for correlation (`triage-id`, `incident-id`)
- `idempotencyKey` — prevents duplicate emails on retry (24h window)
- `replyTo` — set to reporter's email so replies go to them
- No attachments needed for MVP

### Tools Needed

1. **`sendTicketNotification`** — When a ticket is created, notify the assigned engineer
   - Input: assignee email, ticket title, triage summary, severity, Linear URL
   - Output: `{ success, emailId }` or `{ success: false, error }`

2. **`sendResolutionNotification`** — When resolved, notify the reporter(s)
   - Input: reporter email(s), original title, resolution summary, PR link
   - Output: `{ success, emailId }` or `{ success: false, error }`

### Design Decision: No MCP for Resend

There's no official Resend MCP server. Third-party options exist but add unnecessary dependency. The `resend` npm package is 23KB, well-documented, and trivial to wrap as Mastra tools. Direct integration is the clear winner.

---

## 4. Mastra Tool Architecture

### `createTool` API (confirmed from docs)

```typescript
import { createTool } from '@mastra/core/tools'
import { z } from 'zod'

export const myTool = createTool({
  id: 'tool-id',
  description: 'What the tool does (used by agent for tool selection)',
  inputSchema: z.object({ ... }),  // Zod schema
  outputSchema: z.object({ ... }), // Zod schema
  execute: async (input, context) => {
    // input is typed per inputSchema
    // context has: requestContext, tracingContext, abortSignal, agent, workflow
    return { ... } // Must match outputSchema
  },
  toModelOutput: (output) => {
    // Optional: shape what the model sees
    return { type: 'text', value: 'Summary for model' }
  }
})
```

**Tool registration:** Via barrel re-export in `src/mastra/tools/index.ts`, then referenced in agent's `tools` config by key name.

**Tool naming:** The `toolName` seen in stream responses is the **object key**, not the `id`:
```typescript
tools: { createLinearTicket } // toolName: "createLinearTicket"
```

This is critical for the frontend's Generative UI — `message.parts` will reference `tool-createLinearTicket`.

### Execution Context

The `execute` function's second parameter gives access to:
- `context.agent.suspend()` — for human-in-the-loop approval
- `context.requestContext` — shared dependencies
- `context.tracingContext` — Langfuse spans
- `context.abortSignal` — cancellation

We can use `requireApproval: true` on the ticket creation tool to trigger the approval gate in the frontend (the TriageCard "Create Ticket" button).

---

## 5. Proposed Tool Design (5 Linear + 2 Resend)

### File: `runtime/src/mastra/tools/linear.ts`

```
Tools:
1. createLinearIssue    — Create a fully populated ticket
2. updateLinearIssue    — Update status, assignee, labels, description
3. getLinearIssue       — Get issue by ID (supports TRI-123 shorthand)
4. searchLinearIssues   — Filter/search for duplicate detection
5. getLinearTeamMembers — Get team members for auto-assignment
```

**Shared:** LinearClient singleton initialized from `LINEAR_API_KEY` env var. If key is empty/missing, all tools return `{ success: false, error: 'LINEAR_API_KEY not configured' }` — graceful degradation triggers local ticket fallback in workflow.

### File: `runtime/src/mastra/tools/resend.ts`

```
Tools:
6. sendTicketNotification      — Notify engineer of new ticket
7. sendResolutionNotification  — Notify reporter(s) of resolution
```

**Shared:** Resend client initialized from `RESEND_API_KEY`. From address from `RESEND_FROM_EMAIL`. If key is empty, tools log to console and return success (email never blocks triage).

### Schemas: `runtime/src/lib/schemas/ticket.ts`

```typescript
// Shared between Linear tools and frontend triage card
export const ticketCreateSchema = z.object({
  title: z.string(),
  description: z.string(),  // markdown
  teamId: z.string(),
  priority: z.number().min(0).max(4),  // 0=none, 1=urgent, 2=high, 3=medium, 4=low
  assigneeId: z.string().optional(),
  labelIds: z.array(z.string()).optional(),
  stateId: z.string().optional(),
})

export const ticketResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    id: z.string(),
    identifier: z.string(),  // TRI-123
    url: z.string(),
    title: z.string(),
  }).optional(),
  error: z.string().optional(),
})
```

---

## 6. Env Variables Added

| Variable | Value | Purpose |
|----------|-------|---------|
| `LINEAR_API_KEY` | `CHANGEME` | Linear personal API key |
| `RESEND_API_KEY` | `CHANGEME` | Resend email API key |
| `RESEND_FROM_EMAIL` | `triage@agenticengineering.lat` | Sender address for notifications |

All added to `.env` on integration branch. `RESEND_FROM_EMAIL` added to `.env.example`.

**IMPORTANT:** `agenticengineering.lat` domain must be verified in Resend dashboard with SPF/DKIM/DMARC DNS records before emails will deliver successfully. Without this, the API will accept the request but emails may bounce or land in spam.

---

## 7. Dependencies to Install (runtime)

```bash
npm install @linear/sdk resend
```

No other dependencies needed. Both are small, well-maintained packages:
- `@linear/sdk` — Official Linear TypeScript SDK
- `resend` — Official Resend Node.js SDK (23KB)

---

## 8. Webhook Strategy (Resolution Flow)

The triage workflow suspends after ticket creation, waiting for resolution. When someone marks a ticket "Done" in Linear, we need to resume the workflow.

**Implementation:**
1. On runtime startup, programmatically create a Linear webhook via SDK:
   ```typescript
   await linearClient.createWebhook({
     url: `${WEBHOOK_BASE_URL}/api/webhooks/linear`,
     resourceTypes: ['Issue'],
     teamId: TEAM_ID
   })
   ```
2. Webhook handler at `/api/webhooks/linear` verifies HMAC signature, checks `action === 'update'` and state change to "Done", then resumes the suspended workflow.
3. For local dev/demo: mock trigger button in UI calls the same resume endpoint.

**This is ONLY possible with the SDK approach.** The MCP server has no webhook management tools.

---

## 9. Smoke Test Results (CONFIRMED 2026-04-08)

### Linear SDK ✅
- Auth: OK — User: Fernando (lfernando.rramos@gmail.com)
- Org: Agentic Engineering
- Team: triage-hackathon — ID: 645a639b-39e2-4abe-8ded-3346d2f79f9f
- Members: Fernando, Koki, Chenko, Lalo (+ Linear bot, Notion AI, Codex, GitHub Copilot)
- Workflow states: Triage → Backlog → Todo → In Progress → In Review → Done | Duplicate, Canceled
- Labels: tier-1/2/3/4, Bug, Feature, Improvement, + domain labels (frontend, runtime, agent, etc.)
- KEY FINDING: Severity labels already exist as tier-1/2/3/4. We map to these instead of creating new ones.
- KEY FINDING: "Triage" workflow state exists (type: triage). New issues auto-land here.

### Resend SDK ✅
- API key: Valid
- Custom domain (agenticengineering.lat): VERIFIED — emails deliver successfully
- Test email sent and confirmed: ID adee04f2-f6ed-4791-afd5-79cf75f08961
- From address "Triage <triage@agenticengineering.lat>" works.
- NO DNS SETUP NEEDED — domain already configured.

### State/Label IDs for Implementation

```typescript
// Workflow States
const STATES = {
  TRIAGE:      '582398ee-98b0-406b-b2f6-8bca23c1b607',
  BACKLOG:     'b4bc738c-c3a5-4355-a3fe-72d183ec21ee',
  TODO:        '3b9b9b60-e6eb-4914-9e1d-f3c8ce1eba0c',
  IN_PROGRESS: '889e861e-3bd6-4f98-888d-3e976ee583e9',
  IN_REVIEW:   '1b1e7e58-03e7-4bb9-be10-669444e7b377',
  DONE:        '0b0ac11a-a9c1-46d9-a10a-dabb935b53af',
  DUPLICATE:   '5a98d91e-773d-4301-a966-1398ae99b906',
  CANCELED:    '19d1f436-5f3e-420b-a197-f31cfd2636f6',
} as const

// Severity Labels (map from triage output)
const SEVERITY_LABELS = {
  CRITICAL: '60a50b72-d1c2-4823-9111-f85f345138d7', // tier-1
  HIGH:     '500cd0cb-2501-43e9-ad91-fba598d40a54', // tier-2
  MEDIUM:   'bca8aa2f-e32b-49a3-9bc4-18a33c4c832e', // tier-3
  LOW:      '28fe88b4-88fa-4cd5-a35d-dcec4e4df82d', // tier-4
} as const

// Category Labels
const CATEGORY_LABELS = {
  BUG:         'f599da19-8743-4569-a110-a666dc588811',
  FEATURE:     '909d247a-40f4-48d5-a104-c238cc2ab45b',
  IMPROVEMENT: '50756390-d166-4b79-a740-ceefb203751f',
} as const

// Team
const TEAM_ID = '645a639b-39e2-4abe-8ded-3346d2f79f9f'

// Members
const MEMBERS = {
  FERNANDO: '90b16a9c-3f47-49fc-8d98-abf3aa6ecb13',
  KOKI:     'c3f725e4-aa51-45d3-af43-d29a87077226',
  CHENKO:   '7d177d95-4df7-4dff-a3df-710f49eba663',
  LALO:     'b17c4757-ceef-4a13-b3c4-fc2ae09d50de',
} as const
```

## 10. Risk Matrix

| Risk | Impact | Mitigation |
|------|--------|------------|
| Resend domain not verified | Emails bounce | Test with `delivered@resend.dev` first; verify domain ASAP |
| Linear API key permissions | Can't create issues | Test CRUD operations immediately after setup |
| Rate limiting (Linear) | Operations fail | 5000 req/hr is generous; add retry with backoff |
| Rate limiting (Resend) | Emails queued | 5 req/sec fine; use idempotencyKey on retries |
| Linear API down at demo | No tickets | Graceful degradation to local_tickets table |
| Resend API down at demo | No emails | Console log + "email would be sent" in UI |

---

## 10. Spec Scope Recommendation

The SpecSafe spec for this integration should cover:

**In scope:**
- Linear tool CRUD (5 tools) with error boundaries
- Resend email tools (2 tools) with graceful degradation
- Zod schemas for ticket create/response
- Config validation (env vars)
- Unit tests with mocked API clients
- Graceful degradation (no API key → local fallback)

**Out of scope (separate specs):**
- Webhook handler (depends on workflow/runtime infrastructure)
- Duplicate detection algorithm (depends on triage agent output)
- Generative UI ticket card (frontend spec, depends on tool output contract)
- Kanban board Linear sync (separate read-only concern)

This keeps the spec focused and implementable independently of the runtime scaffold.
