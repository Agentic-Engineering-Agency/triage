# SPEC-20260408-002: Linear & Resend Integration Tools

**ID:** SPEC-20260408-002
**Name:** linear-resend-integration-tools
**Stage:** SPEC
**Created:** 2026-04-08
**Updated:** 2026-04-08
**Author:** Koki (Runtime/Integrations)
**Branch:** `feature/linear-and-resend-integration`
**Assessment:** `docs/linear-resend-integration-assessment.md`

> Manual sync note (2026-04-08): the tool modules and their unit tests are implemented on this branch. The `Stage` metadata and `PROJECT_STATE.md` have not been advanced here because project rules require SpecSafe workflow updates for source-of-truth state changes.

## Purpose

Implement 7 Mastra tools (5 Linear + 2 Resend) as self-contained TypeScript modules for the triage workflow. These tools provide: Linear issue CRUD for ticket management, team member lookup for auto-assignment, and Resend email notifications for ticket creation and resolution. All tools follow the architecture's tool-level error boundary pattern, use singleton API clients, and degrade gracefully when API keys are missing.

## Scope

### In Scope
- 5 Linear tools in `runtime/src/mastra/tools/linear.ts` using `@linear/sdk`
- 2 Resend tools in `runtime/src/mastra/tools/resend.ts` using `resend` npm package
- Shared Zod schemas in `runtime/src/lib/schemas/ticket.ts`
- Config/env validation in `runtime/src/lib/config.ts`
- Barrel re-export in `runtime/src/mastra/tools/index.ts`
- Unit tests with mocked API clients (co-located test files)

### Out of Scope
- Linear webhook handler (depends on workflow/runtime infrastructure — separate spec)
- Duplicate detection algorithm (depends on triage agent output — workflow spec)
- Generative UI ticket card rendering (frontend spec, consumes tool output contract)
- Kanban board Linear sync (separate read-only concern)
- Runtime scaffold (`npm create mastra@latest`) — being built in parallel
- Domain DNS verification for Resend (already confirmed verified)
- Email HTML template design (basic branded template sufficient for MVP)

## Dependencies

### External Packages
- `@linear/sdk` — Official Linear TypeScript SDK (GraphQL client)
- `resend` — Official Resend Node.js SDK (23KB)
- `@mastra/core/tools` — `createTool` factory (provided by Mastra runtime)
- `zod` — Schema validation (provided by Mastra runtime)

### Internal Dependencies
- Runtime scaffold must exist at `runtime/` with `package.json` and TypeScript config
- `.env` must contain `LINEAR_API_KEY`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`

### Confirmed Live Data (Smoke-Tested 2026-04-08)

**Team:** triage-hackathon — `645a639b-39e2-4abe-8ded-3346d2f79f9f`

**Workflow States:**
| State | ID (short) | Full UUID |
|-------|-----------|-----------|
| Triage | 582398ee | 582398ee-98b0-406b-b2f6-8bca23c1b607 |
| Backlog | b4bc738c | b4bc738c-c3a5-4355-a3fe-72d183ec21ee |
| Todo | 3b9b9b60 | 3b9b9b60-e6eb-4914-9e1d-f3c8ce1eba0c |
| In Progress | 889e861e | 889e861e-3bd6-4f98-888d-3e976ee583e9 |
| In Review | 1b1e7e58 | 1b1e7e58-03e7-4bb9-be10-669444e7b377 |
| Done | 0b0ac11a | 0b0ac11a-a9c1-46d9-a10a-dabb935b53af |
| Duplicate | 5a98d91e | 5a98d91e-773d-4301-a966-1398ae99b906 |
| Canceled | 19d1f436 | 19d1f436-5f3e-420b-a197-f31cfd2636f6 |

**Severity Labels:**
| Severity | Label Name | ID (short) | Full UUID |
|----------|-----------|-----------|-----------|
| Critical | tier-1 | 60a50b72 | 60a50b72-d1c2-4823-9111-f85f345138d7 |
| High | tier-2 | 500cd0cb | 500cd0cb-2501-43e9-ad91-fba598d40a54 |
| Medium | tier-3 | bca8aa2f | bca8aa2f-e32b-49a3-9bc4-18a33c4c832e |
| Low | tier-4 | 28fe88b4 | 28fe88b4-88fa-4cd5-a35d-dcec4e4df82d |

**Category Labels:**
| Category | ID (short) | Full UUID |
|----------|-----------|-----------|
| Bug | f599da19 | f599da19-8743-4569-a110-a666dc588811 |
| Feature | 909d247a | 909d247a-40f4-48d5-a104-c238cc2ab45b |
| Improvement | 50756390 | 50756390-d166-4b79-a740-ceefb203751f |

**Team Members:**
| Name | ID (short) | Full UUID |
|------|-----------|-----------|
| Fernando | 90b16a9c | 90b16a9c-3f47-49fc-8d98-abf3aa6ecb13 |
| Koki | c3f725e4 | c3f725e4-aa51-45d3-af43-d29a87077226 |
| Chenko | 7d177d95 | 7d177d95-4df7-4dff-a3df-710f49eba663 |
| Lalo | b17c4757 | b17c4757-ceef-4a13-b3c4-fc2ae09d50de |

## Requirements

### REQ-1: Tool-Level Error Boundary Pattern
**Priority:** P0
**Description:** All 7 tools MUST follow the architecture's tool-level error boundary pattern: a single try/catch wrapping the entire `execute` function body. Success returns `{ success: true, data: T }`. Failure returns `{ success: false, error: string }`. No nested try/catch inside the tool — internal code (SDK calls, DB queries) can throw normally; the tool catches.

#### Acceptance Criteria
- **GIVEN** any tool execute function **WHEN** the SDK call throws **THEN** the tool catches and returns `{ success: false, error: "descriptive message" }`
- **GIVEN** any tool execute function **WHEN** the SDK call succeeds **THEN** the tool returns `{ success: true, data: T }` matching the outputSchema
- **GIVEN** an unexpected error (TypeError, network) **WHEN** thrown inside a tool **THEN** the tool catches it and returns a structured error, never an unhandled rejection

#### Scenarios
- S-REQ1-A: SDK throws `InvalidInputLinearError` → tool returns `{ success: false, error: "Linear API error: Invalid input - ..." }`
- S-REQ1-B: Resend returns `{ data: null, error: { message: "..." } }` → tool returns `{ success: false, error: "Resend error: ..." }`
- S-REQ1-C: Network timeout → tool returns `{ success: false, error: "Linear API error: Request timed out" }`

---

### REQ-2: Linear API Key Graceful Degradation
**Priority:** P0
**Description:** When `LINEAR_API_KEY` is empty, missing, or undefined, ALL 5 Linear tools MUST return `{ success: false, error: "LINEAR_API_KEY not configured" }` immediately without attempting any API call. This enables the workflow to fall back to local ticket storage in the `local_tickets` DB table.

#### Acceptance Criteria
- **GIVEN** LINEAR_API_KEY is empty string **WHEN** any Linear tool is called **THEN** it returns `{ success: false, error: "LINEAR_API_KEY not configured" }` without making any network request
- **GIVEN** LINEAR_API_KEY is undefined **WHEN** any Linear tool is called **THEN** same graceful error
- **GIVEN** LINEAR_API_KEY is set and valid **WHEN** any Linear tool is called **THEN** it proceeds normally with the API call

#### Scenarios
- S-REQ2-A: `createLinearIssue` called with no API key → returns graceful error, workflow creates local ticket instead
- S-REQ2-B: `getLinearIssue` called with no API key → returns graceful error, workflow shows "Linear unavailable"

---

### REQ-3: Resend API Key Graceful Degradation
**Priority:** P0
**Description:** When `RESEND_API_KEY` is empty, missing, or undefined, BOTH Resend tools MUST log the email content to console (`console.log`) and return `{ success: true }` (NOT an error). Email notification failure MUST NEVER block the triage workflow. The log must include recipient, subject, and a note that the email was skipped.

#### Acceptance Criteria
- **GIVEN** RESEND_API_KEY is empty **WHEN** sendTicketNotification is called **THEN** it logs to console and returns `{ success: true }`
- **GIVEN** RESEND_API_KEY is empty **WHEN** sendResolutionNotification is called **THEN** it logs to console and returns `{ success: true }`
- **GIVEN** RESEND_API_KEY is valid **WHEN** any email tool is called **THEN** it sends the email via Resend API
- **GIVEN** any email tool **WHEN** it returns **THEN** the return value NEVER has `success: false` due to missing API key (only due to actual send errors)

#### Scenarios
- S-REQ3-A: No RESEND_API_KEY → console shows `[Resend] Skipping email to engineer@example.com: "New Triage Ticket: API Crash"` → returns success
- S-REQ3-B: RESEND_API_KEY present but Resend API returns error → returns `{ success: false, error: "..." }` (API errors are reported)

---

### REQ-4: Shared Zod Schemas
**Priority:** P0
**Description:** All Zod schemas for tool inputs and outputs MUST be defined in `runtime/src/lib/schemas/ticket.ts` and imported by the tools. Schemas MUST NOT be defined inline in tool files. These schemas are the shared contract between Linear tools, Resend tools, the triage workflow, and the frontend (Generative UI).

#### Acceptance Criteria
- **GIVEN** `runtime/src/lib/schemas/ticket.ts` **WHEN** inspected **THEN** it exports all schemas used by the 7 tools
- **GIVEN** any tool file **WHEN** inspected **THEN** inputSchema and outputSchema reference imported schemas, not inline z.object() definitions
- **GIVEN** the schemas **WHEN** used by frontend code **THEN** they can be imported from the same file without pulling in tool/SDK dependencies

#### Schemas Required
```
ticketCreateSchema        — createLinearIssue input
ticketResponseSchema      — createLinearIssue output (shared with getLinearIssue partial)
ticketUpdateSchema        — updateLinearIssue input
issueDetailSchema         — getLinearIssue output
issueSearchSchema         — searchLinearIssues input
issueSearchResultSchema   — searchLinearIssues output
teamMemberSchema          — single member object
teamMembersResponseSchema — getLinearTeamMembers output
ticketNotificationSchema  — sendTicketNotification input
resolutionNotificationSchema — sendResolutionNotification input
emailResponseSchema       — shared email tool output
toolSuccessSchema         — generic { success: true, data: T }
toolErrorSchema           — generic { success: false, error: string }
```

---

### REQ-5: LinearClient Singleton
**Priority:** P0
**Description:** The `LinearClient` from `@linear/sdk` MUST be instantiated once at module level in `linear.ts` and reused across all 5 Linear tools. This avoids creating new GraphQL client instances on every tool call and ensures consistent connection state.

#### Acceptance Criteria
- **GIVEN** `linear.ts` module **WHEN** loaded **THEN** it creates exactly one `LinearClient` instance (or null if API key missing)
- **GIVEN** multiple Linear tool calls **WHEN** executed sequentially or concurrently **THEN** they all use the same LinearClient instance
- **GIVEN** the client is exported or accessible at module level **WHEN** tests need to mock it **THEN** the mock can replace the module-level reference

#### Implementation Pattern
```typescript
// Module-level singleton (supports test mocking via module replacement)
const linearClient = process.env.LINEAR_API_KEY
  ? new LinearClient({ apiKey: process.env.LINEAR_API_KEY })
  : null;
```

---

### REQ-6: Resend Client Singleton
**Priority:** P0
**Description:** The Resend client MUST be instantiated once at module level in `resend.ts` and reused across both email tools. Same singleton pattern as LinearClient.

#### Acceptance Criteria
- **GIVEN** `resend.ts` module **WHEN** loaded **THEN** it creates exactly one `Resend` instance (or null if API key missing)
- **GIVEN** the `RESEND_FROM_EMAIL` env var **WHEN** read **THEN** it is stored as a module-level constant and used as the `from` address in all emails

#### Implementation Pattern
```typescript
const resendClient = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'triage@agenticengineering.lat';
```

---

### REQ-7: Concise Tool Descriptions
**Priority:** P1
**Description:** Each tool's `description` field MUST be concise and action-oriented. The agent uses these descriptions for tool selection — verbose descriptions waste tokens and confuse tool selection. Maximum 1-2 sentences.

#### Acceptance Criteria
- **GIVEN** any tool definition **WHEN** its description is inspected **THEN** it is ≤ 200 characters
- **GIVEN** a tool description **WHEN** read by the triage agent **THEN** it clearly conveys what the tool does and when to use it

#### Tool Descriptions
| Tool | Description |
|------|-------------|
| createLinearIssue | "Create a new Linear issue with title, description, priority, and optional assignee/labels." |
| updateLinearIssue | "Update fields on an existing Linear issue (status, assignee, priority, labels)." |
| getLinearIssue | "Get a Linear issue by ID or shorthand identifier (e.g. TRI-123)." |
| searchLinearIssues | "Search Linear issues by title, status, assignee, or labels. Use for duplicate detection." |
| getLinearTeamMembers | "Get all members of a Linear team. Use for auto-assignment decisions." |
| sendTicketNotification | "Send an email notification to the assigned engineer about a new triage ticket." |
| sendResolutionNotification | "Send an email notification to reporter(s) that their issue has been resolved." |

---

### REQ-8: Human-in-the-Loop Approval Gate
**Priority:** P0
**Description:** The `createLinearIssue` tool MUST set `requireApproval: true` in its `createTool` definition. This triggers the Mastra approval flow — the agent suspends execution, the frontend renders a Confirmation component (via AI SDK Elements), and the user must approve before the issue is actually created in Linear. This is the "Create Ticket" button in the triage card.

#### Acceptance Criteria
- **GIVEN** `createLinearIssue` tool definition **WHEN** inspected **THEN** it has `requireApproval: true`
- **GIVEN** the agent calls createLinearIssue **WHEN** execution reaches this tool **THEN** the agent suspends and waits for user approval
- **GIVEN** the user approves **WHEN** execution resumes **THEN** the tool creates the issue in Linear
- **GIVEN** the user denies **WHEN** execution resumes **THEN** the tool does NOT create the issue

#### Scenarios
- S-REQ8-A: Triage agent proposes a ticket → frontend shows TriageCard with "Create Ticket" button → user clicks → issue created in Linear
- S-REQ8-B: Triage agent proposes a ticket → user sees something wrong → denies → no issue created, agent informed

---

### REQ-9: Idempotency Keys for Email
**Priority:** P1
**Description:** Both Resend tools MUST use Resend's `Idempotency-Key` header to prevent duplicate emails on workflow retry. The key pattern MUST incorporate the Linear issue ID for deterministic dedup within the 24-hour idempotency window.

#### Acceptance Criteria
- **GIVEN** `sendTicketNotification` **WHEN** called with a linearIssueId **THEN** it passes `headers: { 'Idempotency-Key': 'ticket-notify/{linearIssueId}' }` to Resend
- **GIVEN** `sendResolutionNotification` **WHEN** called with a linearIssueId **THEN** it passes `headers: { 'Idempotency-Key': 'resolution-notify/{linearIssueId}' }` to Resend
- **GIVEN** the same email tool is called twice with the same linearIssueId within 24 hours **WHEN** the second call executes **THEN** Resend deduplicates and only one email is sent

#### Scenarios
- S-REQ9-A: Workflow retries after transient failure → second sendTicketNotification call with same issue ID → Resend returns cached response, only 1 email sent
- S-REQ9-B: New issue created → different linearIssueId → new idempotency key → new email sent

---

### REQ-10: Testable via Mocked API Clients
**Priority:** P1
**Description:** All tools MUST be testable with mocked API clients. The module-level singleton pattern (REQ-5, REQ-6) enables test mocking by replacing the module-level client variable. Tests must NOT require live API keys or network access.

#### Acceptance Criteria
- **GIVEN** a test file **WHEN** it mocks the LinearClient at module level **THEN** all Linear tools use the mocked client
- **GIVEN** a test file **WHEN** it mocks the Resend client at module level **THEN** all email tools use the mocked client
- **GIVEN** any test **WHEN** run in CI without API keys **THEN** all tests pass (no live API calls)

#### Implementation Pattern
```typescript
// In test file:
vi.mock('@linear/sdk', () => ({
  LinearClient: vi.fn().mockImplementation(() => ({
    createIssue: vi.fn().mockResolvedValue({ success: true, issue: mockIssue }),
    // ...
  })),
}));
```

---

## Tool Specifications

### Tool 1: createLinearIssue

**File:** `runtime/src/mastra/tools/linear.ts`
**Tool ID:** `create-linear-issue`
**Export Name:** `createLinearIssue`
**Require Approval:** `true`

**Input Schema** (from `ticketCreateSchema`):
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| title | string | yes | Issue title |
| description | string | yes | Issue description (markdown) |
| teamId | string | yes | Linear team UUID |
| priority | number (0-4) | yes | 0=none, 1=urgent, 2=high, 3=medium, 4=low |
| assigneeId | string | no | User UUID for auto-assignment |
| labelIds | string[] | no | Label UUIDs (severity + category) |
| stateId | string | no | Workflow state UUID (default: Triage) |

**Output Schema** (from `ticketResponseSchema`):
| Field | Type | Description |
|-------|------|-------------|
| success | boolean | true on success |
| data.id | string | Linear issue UUID |
| data.identifier | string | Human-readable ID (e.g. TRI-123) |
| data.url | string | Linear web URL |
| data.title | string | Issue title as created |
| error | string? | Error message on failure |

**SDK Call:**
```typescript
const result = await linearClient.createIssue({
  teamId: input.teamId,
  title: input.title,
  description: input.description,
  priority: input.priority,
  assigneeId: input.assigneeId,
  labelIds: input.labelIds,
  stateId: input.stateId,
});
// result.success is boolean, result.issue contains the created issue
const issue = await result.issue;
// issue.id, issue.identifier, issue.url, issue.title
```

---

### Tool 2: updateLinearIssue

**File:** `runtime/src/mastra/tools/linear.ts`
**Tool ID:** `update-linear-issue`
**Export Name:** `updateLinearIssue`

**Input Schema** (from `ticketUpdateSchema`):
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| issueId | string | yes | Linear issue UUID or identifier (TRI-123) |
| title | string | no | New title |
| description | string | no | New description (markdown) |
| priority | number (0-4) | no | New priority |
| assigneeId | string | no | New assignee UUID |
| stateId | string | no | New workflow state UUID |
| labelIds | string[] | no | Replace all labels |

**Output Schema:**
| Field | Type | Description |
|-------|------|-------------|
| success | boolean | true on success |
| data.id | string | Issue UUID |
| data.identifier | string | Human-readable ID |
| data.url | string | Linear web URL |
| error | string? | Error message on failure |

**SDK Call:**
```typescript
const result = await linearClient.updateIssue(input.issueId, {
  title: input.title,
  description: input.description,
  priority: input.priority,
  assigneeId: input.assigneeId,
  stateId: input.stateId,
  labelIds: input.labelIds,
});
const issue = await result.issue;
```

---

### Tool 3: getLinearIssue

**File:** `runtime/src/mastra/tools/linear.ts`
**Tool ID:** `get-linear-issue`
**Export Name:** `getLinearIssue`

**Input Schema:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| issueId | string | yes | Issue UUID or shorthand (TRI-123) |

**Output Schema** (from `issueDetailSchema`):
| Field | Type | Description |
|-------|------|-------------|
| success | boolean | true on success |
| data.id | string | Issue UUID |
| data.identifier | string | TRI-123 |
| data.title | string | Issue title |
| data.description | string? | Issue description |
| data.state | { id, name, type } | Workflow state |
| data.assignee | { id, name, email }? | Assigned user |
| data.labels | Array<{ id, name }> | Applied labels |
| data.priority | number | Priority level (0-4) |
| data.url | string | Linear web URL |
| data.createdAt | string | ISO 8601 |
| data.updatedAt | string | ISO 8601 |
| error | string? | Error message on failure |

**SDK Call:**
```typescript
const issue = await linearClient.issue(input.issueId);
const state = await issue.state;
const assignee = await issue.assignee;
const labels = await issue.labels();
```

**Note:** Linear SDK uses lazy-loaded relations — `issue.state`, `issue.assignee`, `issue.labels()` each make a GraphQL call. Await them all for the full response.

---

### Tool 4: searchLinearIssues

**File:** `runtime/src/mastra/tools/linear.ts`
**Tool ID:** `search-linear-issues`
**Export Name:** `searchLinearIssues`

**Input Schema** (from `issueSearchSchema`):
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| query | string | no | Text search (title/description contains) |
| teamId | string | no | Filter by team UUID |
| status | string | no | Filter by state name (e.g. "In Progress") |
| assigneeId | string | no | Filter by assignee UUID |
| labels | string[] | no | Filter by label names |
| priority | number | no | Filter by priority (0-4) |
| limit | number | no | Max results (default: 10, max: 50) |

**Output Schema** (from `issueSearchResultSchema`):
| Field | Type | Description |
|-------|------|-------------|
| success | boolean | true on success |
| data.issues | Array | Matching issues (id, identifier, title, state, priority, url) |
| data.totalCount | number | Total matching count |
| error | string? | Error message on failure |

**SDK Call:**
```typescript
const filter: Record<string, unknown> = {};
if (input.query) filter.title = { containsIgnoreCase: input.query };
if (input.teamId) filter.team = { id: { eq: input.teamId } };
if (input.assigneeId) filter.assignee = { id: { eq: input.assigneeId } };
if (input.priority !== undefined) filter.priority = { eq: input.priority };
// ... build filter object dynamically

const result = await linearClient.issues({
  filter,
  first: input.limit || 10,
});
```

**Note:** This tool is critical for duplicate detection. The triage workflow calls it with the proposed title before creating a new issue.

---

### Tool 5: getLinearTeamMembers

**File:** `runtime/src/mastra/tools/linear.ts`
**Tool ID:** `get-linear-team-members`
**Export Name:** `getLinearTeamMembers`

**Input Schema:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| teamId | string | yes | Team UUID |

**Output Schema** (from `teamMembersResponseSchema`):
| Field | Type | Description |
|-------|------|-------------|
| success | boolean | true on success |
| data.members | Array<{ id, name, email, displayName }> | Human team members |
| error | string? | Error message on failure |

**SDK Call:**
```typescript
const team = await linearClient.team(input.teamId);
const members = await team.members();
// Filter out bot accounts (Linear bot, Notion AI, Codex, GitHub Copilot)
const humanMembers = members.nodes.filter(m => !m.isMe || m.email);
```

**Note:** The smoke test revealed bot accounts (Linear bot, Notion AI, Codex, GitHub Copilot) in the members list. Filter these out by checking for `isBot` flag or absence of email. Return only human members for auto-assignment.

---

### Tool 6: sendTicketNotification

**File:** `runtime/src/mastra/tools/resend.ts`
**Tool ID:** `send-ticket-notification`
**Export Name:** `sendTicketNotification`

**Input Schema** (from `ticketNotificationSchema`):
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| to | string | yes | Recipient email address |
| ticketTitle | string | yes | Issue title |
| severity | string | yes | "Critical", "High", "Medium", or "Low" |
| priority | number | yes | Priority level (0-4) |
| summary | string | yes | Triage summary (markdown) |
| linearUrl | string | yes | Linear issue URL |
| assigneeName | string | yes | Name of assigned engineer |
| linearIssueId | string | yes | Issue UUID (for idempotency key) |

**Output Schema** (from `emailResponseSchema`):
| Field | Type | Description |
|-------|------|-------------|
| success | boolean | true on success (also true when API key missing — graceful skip) |
| emailId | string? | Resend email ID on actual send |
| error | string? | Error message on send failure |

**SDK Call:**
```typescript
const { data, error } = await resendClient.emails.send({
  from: `Triage <${FROM_EMAIL}>`,
  to: input.to,
  subject: `[${input.severity}] New Triage Ticket: ${input.ticketTitle}`,
  html: renderTicketNotificationHtml(input),
  headers: {
    'Idempotency-Key': `ticket-notify/${input.linearIssueId}`,
  },
});
```

**Graceful Degradation (no API key):**
```typescript
if (!resendClient) {
  console.log(`[Resend] Skipping ticket notification to ${input.to}: "${input.ticketTitle}" (RESEND_API_KEY not configured)`);
  return { success: true };
}
```

**Email Template:** Basic branded HTML with:
- Subject: `[Critical] New Triage Ticket: API Crash in Auth Module`
- Greeting: `Hi {assigneeName},`
- Body: Ticket title, severity badge, triage summary, link to Linear issue
- Footer: Sent by Triage (agenticengineering.lat)

---

### Tool 7: sendResolutionNotification

**File:** `runtime/src/mastra/tools/resend.ts`
**Tool ID:** `send-resolution-notification`
**Export Name:** `sendResolutionNotification`

**Input Schema** (from `resolutionNotificationSchema`):
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| to | string or string[] | yes | Reporter email(s) |
| originalTitle | string | yes | Original issue title |
| resolutionSummary | string | yes | How it was resolved |
| prLink | string | no | Pull request URL |
| linearUrl | string | yes | Linear issue URL |
| linearIssueId | string | yes | Issue UUID (for idempotency key) |

**Output Schema** (from `emailResponseSchema`):
| Field | Type | Description |
|-------|------|-------------|
| success | boolean | true on success |
| emailId | string? | Resend email ID |
| error | string? | Error message on failure |

**SDK Call:**
```typescript
const { data, error } = await resendClient.emails.send({
  from: `Triage <${FROM_EMAIL}>`,
  to: Array.isArray(input.to) ? input.to : [input.to],
  subject: `[Resolved] ${input.originalTitle}`,
  html: renderResolutionNotificationHtml(input),
  headers: {
    'Idempotency-Key': `resolution-notify/${input.linearIssueId}`,
  },
});
```

---

## File Specifications

### File: `runtime/src/lib/schemas/ticket.ts`

Exports all Zod schemas shared between tools and frontend. Must NOT import any SDK dependencies — only `zod`.

```typescript
import { z } from 'zod';

// --- Shared primitives ---
export const prioritySchema = z.number().min(0).max(4);

// --- Linear tool schemas ---
export const ticketCreateSchema = z.object({
  title: z.string().min(1),
  description: z.string(),
  teamId: z.string().uuid(),
  priority: prioritySchema,
  assigneeId: z.string().uuid().optional(),
  labelIds: z.array(z.string().uuid()).optional(),
  stateId: z.string().uuid().optional(),
});

export const ticketResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    id: z.string(),
    identifier: z.string(),
    url: z.string().url(),
    title: z.string(),
  }).optional(),
  error: z.string().optional(),
});

export const ticketUpdateSchema = z.object({
  issueId: z.string().min(1),
  title: z.string().optional(),
  description: z.string().optional(),
  priority: prioritySchema.optional(),
  assigneeId: z.string().uuid().optional(),
  stateId: z.string().uuid().optional(),
  labelIds: z.array(z.string().uuid()).optional(),
});

export const issueDetailSchema = z.object({
  success: z.boolean(),
  data: z.object({
    id: z.string(),
    identifier: z.string(),
    title: z.string(),
    description: z.string().nullable(),
    state: z.object({ id: z.string(), name: z.string(), type: z.string() }),
    assignee: z.object({ id: z.string(), name: z.string(), email: z.string() }).nullable(),
    labels: z.array(z.object({ id: z.string(), name: z.string() })),
    priority: z.number(),
    url: z.string().url(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }).optional(),
  error: z.string().optional(),
});

export const issueSearchSchema = z.object({
  query: z.string().optional(),
  teamId: z.string().uuid().optional(),
  status: z.string().optional(),
  assigneeId: z.string().uuid().optional(),
  labels: z.array(z.string()).optional(),
  priority: prioritySchema.optional(),
  limit: z.number().min(1).max(50).default(10),
});

export const issueSearchResultSchema = z.object({
  success: z.boolean(),
  data: z.object({
    issues: z.array(z.object({
      id: z.string(),
      identifier: z.string(),
      title: z.string(),
      state: z.object({ id: z.string(), name: z.string() }),
      priority: z.number(),
      url: z.string(),
    })),
    totalCount: z.number(),
  }).optional(),
  error: z.string().optional(),
});

export const teamMemberSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  displayName: z.string(),
});

export const teamMembersResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    members: z.array(teamMemberSchema),
  }).optional(),
  error: z.string().optional(),
});

// --- Resend tool schemas ---
export const ticketNotificationSchema = z.object({
  to: z.string().email(),
  ticketTitle: z.string(),
  severity: z.enum(['Critical', 'High', 'Medium', 'Low']),
  priority: prioritySchema,
  summary: z.string(),
  linearUrl: z.string().url(),
  assigneeName: z.string(),
  linearIssueId: z.string(),
});

export const resolutionNotificationSchema = z.object({
  to: z.union([z.string().email(), z.array(z.string().email())]),
  originalTitle: z.string(),
  resolutionSummary: z.string(),
  prLink: z.string().url().optional(),
  linearUrl: z.string().url(),
  linearIssueId: z.string(),
});

export const emailResponseSchema = z.object({
  success: z.boolean(),
  emailId: z.string().optional(),
  error: z.string().optional(),
});
```

### File: `runtime/src/lib/config.ts`

Validates required environment variables at module load. Exports typed config. Does NOT throw on missing keys — tools handle graceful degradation themselves.

```typescript
import { z } from 'zod';

const envSchema = z.object({
  LINEAR_API_KEY: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().email().default('triage@agenticengineering.lat'),
});

export const config = envSchema.parse({
  LINEAR_API_KEY: process.env.LINEAR_API_KEY,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL,
});

// Constants for the triage-hackathon team (confirmed via smoke test)
export const LINEAR_CONSTANTS = {
  TEAM_ID: '645a639b-39e2-4abe-8ded-3346d2f79f9f',
  STATES: {
    TRIAGE: '582398ee-98b0-406b-b2f6-8bca23c1b607',
    BACKLOG: 'b4bc738c-c3a5-4355-a3fe-72d183ec21ee',
    TODO: '3b9b9b60-e6eb-4914-9e1d-f3c8ce1eba0c',
    IN_PROGRESS: '889e861e-3bd6-4f98-888d-3e976ee583e9',
    IN_REVIEW: '1b1e7e58-03e7-4bb9-be10-669444e7b377',
    DONE: '0b0ac11a-a9c1-46d9-a10a-dabb935b53af',
    DUPLICATE: '5a98d91e-773d-4301-a966-1398ae99b906',
    CANCELED: '19d1f436-5f3e-420b-a197-f31cfd2636f6',
  },
  SEVERITY_LABELS: {
    CRITICAL: '60a50b72-d1c2-4823-9111-f85f345138d7',
    HIGH: '500cd0cb-2501-43e9-ad91-fba598d40a54',
    MEDIUM: 'bca8aa2f-e32b-49a3-9bc4-18a33c4c832e',
    LOW: '28fe88b4-88fa-4cd5-a35d-dcec4e4df82d',
  },
  CATEGORY_LABELS: {
    BUG: 'f599da19-8743-4569-a110-a666dc588811',
    FEATURE: '909d247a-40f4-48d5-a104-c238cc2ab45b',
    IMPROVEMENT: '50756390-d166-4b79-a740-ceefb203751f',
  },
  MEMBERS: {
    FERNANDO: '90b16a9c-3f47-49fc-8d98-abf3aa6ecb13',
    KOKI: 'c3f725e4-aa51-45d3-af43-d29a87077226',
    CHENKO: '7d177d95-4df7-4dff-a3df-710f49eba663',
    LALO: 'b17c4757-ceef-4a13-b3c4-fc2ae09d50de',
  },
} as const;
```

### File: `runtime/src/mastra/tools/index.ts`

Barrel re-export for Mastra registration. This is one of the 3 allowed barrel files per architecture rules.

```typescript
export {
  createLinearIssue,
  updateLinearIssue,
  getLinearIssue,
  searchLinearIssues,
  getLinearTeamMembers,
} from './linear';

export {
  sendTicketNotification,
  sendResolutionNotification,
} from './resend';
```

---

## Technical Approach

### Architecture Alignment

This implementation follows the architecture document precisely:

1. **Tool-level error boundary** (architecture §Implementation Patterns): Single try/catch at tool level. Internal SDK calls throw naturally. Tools always return `{ success, data }` or `{ success: false, error }`.

2. **One file per concern** (architecture §Structure Patterns): All 5 Linear tools in `linear.ts`, both Resend tools in `resend.ts`. Not split per-function.

3. **Naming conventions** (architecture §Naming Patterns):
   - Files: `kebab-case` — `linear.ts`, `resend.ts`, `ticket.ts`
   - Exports: `camelCase` — `createLinearIssue`, `sendTicketNotification`
   - Zod schemas: `camelCase` + `Schema` suffix — `ticketCreateSchema`
   - Constants: `UPPER_SNAKE_CASE` — `LINEAR_CONSTANTS`, `TEAM_ID`

4. **Zod schemas in lib/schemas/** (architecture §Structure Patterns): `ticket.ts` holds all schemas. Tools import from there. Frontend can import without pulling SDK deps.

5. **Config validation** (architecture §Structure Patterns): `lib/config.ts` validates env vars with Zod.

6. **Barrel re-export** (architecture §Structure Patterns): Only in `src/mastra/tools/index.ts` — one of the 3 allowed barrel files.

### Resend Error Handling

The Resend SDK has a unique error pattern — it does NOT throw on API errors. Instead:
```typescript
const { data, error } = await resend.emails.send({...});
// Success: { data: { id: string }, error: null }
// API error: { data: null, error: { message: string, name: string } }
```

The tool error boundary must handle BOTH:
- Network errors (caught by try/catch)
- API errors (checked via `error` field in response)

```typescript
execute: async ({ context: input }) => {
  if (!resendClient) {
    console.log(`[Resend] Skipping email to ${input.to}: "${input.ticketTitle}" (no API key)`);
    return { success: true };
  }
  try {
    const { data, error } = await resendClient.emails.send({...});
    if (error) {
      return { success: false, error: `Resend error: ${error.message}` };
    }
    return { success: true, emailId: data?.id };
  } catch (err) {
    return { success: false, error: `Email send failed: ${err.message}` };
  }
}
```

### Linear SDK Error Handling

The Linear SDK throws typed errors. Key error types:
- `InvalidInputLinearError` — bad input (wrong ID format, missing required field)
- `LinearError` — general API error (rate limit, auth failure, server error)

Each error has `.message`, `.status`, `.type`, `.userError` fields.

```typescript
execute: async ({ context: input }) => {
  if (!linearClient) {
    return { success: false, error: 'LINEAR_API_KEY not configured' };
  }
  try {
    const result = await linearClient.createIssue({...});
    const issue = await result.issue;
    return { success: true, data: { id: issue.id, identifier: issue.identifier, url: issue.url, title: issue.title } };
  } catch (err) {
    return { success: false, error: `Linear API error: ${err.message}` };
  }
}
```

---

## Test Strategy

### Unit Tests (co-located, mocked API clients)

**File:** `runtime/src/mastra/tools/linear.test.ts`
**File:** `runtime/src/mastra/tools/resend.test.ts`

All tests use vitest with module-level mocks. No live API calls required.

### Scenarios

**S1: Create issue with all fields → returns success with identifier**
```
GIVEN linearClient.createIssue resolves with { success: true, issue: { id, identifier: "TRI-42", url, title } }
WHEN createLinearIssue is called with title, description, teamId, priority, assigneeId, labelIds, stateId
THEN it returns { success: true, data: { id, identifier: "TRI-42", url, title } }
```

**S2: Create issue with missing LINEAR_API_KEY → returns graceful error**
```
GIVEN LINEAR_API_KEY is undefined (linearClient is null)
WHEN createLinearIssue is called
THEN it returns { success: false, error: "LINEAR_API_KEY not configured" }
AND no network request is made
```

**S3: Update issue status from Triage to In Progress**
```
GIVEN an existing issue in Triage state
WHEN updateLinearIssue is called with { issueId, stateId: STATES.IN_PROGRESS }
THEN linearClient.updateIssue is called with the correct stateId
AND it returns { success: true, data: { id, identifier, url } }
```

**S4: Get issue by shorthand ID (TRI-123)**
```
GIVEN linearClient.issue("TRI-123") resolves with a full issue object
WHEN getLinearIssue is called with { issueId: "TRI-123" }
THEN it returns { success: true, data: { id, identifier: "TRI-123", title, description, state, assignee, labels, priority, url, createdAt, updatedAt } }
```

**S5: Search issues by title for duplicate detection**
```
GIVEN linearClient.issues({ filter: { title: { containsIgnoreCase: "API crash" } } }) resolves with 2 issues
WHEN searchLinearIssues is called with { query: "API crash", teamId: TEAM_ID }
THEN it returns { success: true, data: { issues: [...2 issues], totalCount: 2 } }
```

**S6: Get team members returns all human members**
```
GIVEN team.members() resolves with 4 humans + 4 bots
WHEN getLinearTeamMembers is called with { teamId: TEAM_ID }
THEN it returns { success: true, data: { members: [...4 human members] } }
AND bot accounts are filtered out
```

**S7: Send ticket notification email → returns emailId**
```
GIVEN resendClient.emails.send resolves with { data: { id: "email-123" }, error: null }
WHEN sendTicketNotification is called with all required fields
THEN it returns { success: true, emailId: "email-123" }
AND resend was called with from: "Triage <triage@agenticengineering.lat>"
AND resend was called with headers containing Idempotency-Key: "ticket-notify/{linearIssueId}"
```

**S8: Send resolution notification to multiple reporters**
```
GIVEN resendClient.emails.send resolves with { data: { id: "email-456" }, error: null }
WHEN sendResolutionNotification is called with { to: ["a@example.com", "b@example.com"], ... }
THEN resend is called with to: ["a@example.com", "b@example.com"]
AND it returns { success: true, emailId: "email-456" }
```

**S9: Send email with missing RESEND_API_KEY → logs to console, returns success**
```
GIVEN RESEND_API_KEY is undefined (resendClient is null)
WHEN sendTicketNotification is called with { to: "eng@example.com", ticketTitle: "API Crash" }
THEN console.log is called with message containing "Skipping" and "eng@example.com" and "API Crash"
AND it returns { success: true } (no error)
AND no network request is made
```

**S10: Send email with idempotencyKey prevents duplicates**
```
GIVEN resendClient is configured
WHEN sendTicketNotification is called with { linearIssueId: "abc-123", ... }
THEN resend.emails.send is called with headers: { "Idempotency-Key": "ticket-notify/abc-123" }
```

**S11: LinearClient is singleton (same instance across tool calls)**
```
GIVEN the linear.ts module is loaded
WHEN createLinearIssue and getLinearIssue are both called
THEN both tools use the same LinearClient instance (verified via mock reference equality)
```

**S12: Config validation rejects invalid env vars**
```
GIVEN RESEND_FROM_EMAIL is set to "not-an-email"
WHEN config.ts is loaded
THEN Zod validation throws with a descriptive error about email format
```

---

## Implementation Plan

### Phase 1: Schemas & Config (est. 20 min)
1. Create `runtime/src/lib/schemas/ticket.ts` with all Zod schemas
2. Create `runtime/src/lib/config.ts` with env validation and LINEAR_CONSTANTS

### Phase 2: Linear Tools (est. 45 min)
3. Create `runtime/src/mastra/tools/linear.ts`:
   - Module-level LinearClient singleton
   - `createLinearIssue` (with `requireApproval: true`)
   - `updateLinearIssue`
   - `getLinearIssue`
   - `searchLinearIssues`
   - `getLinearTeamMembers`

### Phase 3: Resend Tools (est. 30 min)
4. Create `runtime/src/mastra/tools/resend.ts`:
   - Module-level Resend singleton
   - `sendTicketNotification` (with HTML template)
   - `sendResolutionNotification` (with HTML template)
   - Console log fallback for missing API key

### Phase 4: Barrel Export (est. 5 min)
5. Create/update `runtime/src/mastra/tools/index.ts` barrel re-export

### Phase 5: Tests (est. 30 min)
6. Create `runtime/src/mastra/tools/linear.test.ts` — scenarios S1-S6, S11
7. Create `runtime/src/mastra/tools/resend.test.ts` — scenarios S7-S10
8. Create `runtime/src/lib/config.test.ts` — scenario S12

### Phase 6: Validation (est. 10 min)
9. TypeScript compilation check (`tsc --noEmit`)
10. Run all tests (`vitest run`)
11. Verify schemas parse sample data correctly

**Total estimated time: ~2.5 hours**

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Runtime scaffold doesn't exist yet | Can't run tools until scaffold is created | Tools are self-contained modules; can be dropped into runtime/ once scaffolded |
| Linear SDK lazy-loaded relations (issue.state, issue.assignee) require extra await | Unexpected GraphQL calls per tool invocation | Document in tool spec; await all needed relations in one call |
| Bot accounts in team members list | Auto-assignment selects a bot | Filter by isBot flag or email presence in getLinearTeamMembers |
| Resend rate limit (5 req/sec) | Batch triage of 5+ incidents sends many emails simultaneously | Queue emails or batch — unlikely to hit in hackathon (one triage at a time) |
| idempotencyKey 24h window expiry | Late retry (>24h) sends duplicate email | Acceptable for hackathon; production would need DB-level dedup |
| createTool API changes in Mastra v1.23 | Tool definitions may need adjustment | Pin to exact Mastra version; test immediately after scaffold |
