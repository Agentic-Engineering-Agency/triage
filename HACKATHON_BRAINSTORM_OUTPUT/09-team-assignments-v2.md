# Team Assignments v2 — SRE Incident Triage Agent

## Timeline
- **Start:** Tuesday April 7, 2PM
- **Deadline:** Thursday April 9, 9PM COT
- **Total:** ~55 hours (4 people = ~140-160 person-hours with AI tools)

---

## TIER 1 — Must Ship (Core E2E Flow)

| Feature | Owner | Collaborator | Est. Hours |
|---------|-------|-------------|-----------|
| Docker Compose (all containers + Langfuse) | **Lucy** | All (everyone needs container access) | 3-4h |
| Mastra Runtime + first agent | **Coqui** | Lalo | 3-4h |
| Chat UI (includes multimodal: text, image paste, file upload, video) | **Chenko** | — | 6-8h |
| Linear Integration (MCP + `@linear/sdk` tools) | **Coqui** | Lalo | 3-4h |
| Email Notification (Resend) | **Lucy** | — | 2-3h |
| Better Auth (login/register + Drizzle + LibSQL) | **Lucy** | Chenko (frontend auth) | 2-3h |
| Mastra Workflow (intake → triage → ticket → notify → suspend → resolve → notify reporter) | **Lalo** | Coqui (tools) | 4-5h |
| Triage Agent (analyze codebase wiki, propose solution, assign severity/priority/person) | **Lalo** | — | 6-8h |

**Tier 1 Total: ~30-40h across 4 people**

---

## TIER 2 — Should Ship (Differentiators)

| Feature | Owner | Collaborator | Est. Hours |
|---------|-------|-------------|-----------|
| Codebase Wiki Generation (llm-wiki for Solidus) | **Coqui** | All | 5-6h |
| Langfuse Observability (traces across all stages) | **Lucy** | Lalo | 3-4h |
| Generative UI Ticket Cards (AI SDK tool rendering + json-render) | **Chenko** | — | 3-4h |
| Resolution Flow (webhook → verify PR/commits → notify reporter) | **Lalo** | — | 3-4h |
| Prompt Injection Guardrails (Mastra processors) | **Coqui** | — | 2-3h |
| Kanban View (one-way sync from Linear) | **Lucy** | Chenko | 3-4h |
| Severity Scoring (structured output) | **Lalo** | — | 0.5h |
| Deduplication Check (before ticket creation) | **Lalo** | — | 0.5h |
| Import Users from Linear | **Coqui** | — | 1-2h |
| Slack Integration | **Coqui** | — | 2-3h |

**Tier 2 Total: ~24-32h across 4 people**

---

## TIER 3 — Stretch Goals

| Feature | Owner | Est. Hours |
|---------|-------|-----------|
| Electron/Tauri wrapper | Chenko | 2-3h |
| Jira integration | Coqui | 1-2h |
| GitHub Issues integration | Coqui | 1-2h |
| json-render full layout composition | Chenko | 2-3h |
| Resolution Reviewer (CodeRabbit-style PR analysis) | Lalo | 3-4h |

---

## TIER 4 — Documentation (MUST DO, last 4-6 hours)

| Deliverable | Owner | Est. Hours |
|------------|-------|-----------|
| README.md | Lalo | 1h |
| AGENTS_USE.md (9 sections + evidence screenshots) | All | 2-3h |
| SCALING.md | Lucy | 1h |
| QUICKGUIDE.md | Coqui | 1h |
| .env.example | Lucy | 0.5h |
| 3-min YouTube demo video (scripted, timed) | All | 2-3h |

---

## Owner Summary

### Lalo (Lead + Backend/Orchestration)
**Tier 1:** Mastra Workflow, Triage Agent
**Tier 2:** Resolution Flow, Severity Scoring, Deduplication, Langfuse (with Lucy)
**Tier 4:** README.md
**Focus:** Agent logic, workflows, the "brain" of the system

### Lucy (Lead + Infra/Platform)
**Tier 1:** Docker Compose, Email (Resend), Better Auth
**Tier 2:** Langfuse Observability, Kanban View (with Chenko)
**Tier 4:** SCALING.md, .env.example
**Focus:** Infrastructure, containers, auth, observability

### Coqui (Backend/AI + Integrations)
**Tier 1:** Mastra Runtime, Linear Integration
**Tier 2:** Wiki Generation, Prompt Injection Guardrails, Import Users, Slack
**Tier 3:** Jira, GitHub Issues
**Tier 4:** QUICKGUIDE.md
**Focus:** Runtime, integrations, codebase intelligence, security

### Chenko (Frontend)
**Tier 1:** Chat UI (multimodal: text, image paste, file upload, video)
**Tier 2:** Generative UI Ticket Cards, Kanban View (with Lucy)
**Tier 3:** Electron wrapper, json-render layouts
**Focus:** Everything judges SEE — chat, cards, kanban, polish

---

## Dependencies / Collaboration Points

| Dependency | Who Needs It | Who Provides It | When |
|-----------|-------------|----------------|------|
| Docker Compose running | Everyone | Lucy | Day 1 first 2 hours |
| Mastra Runtime responding | Lalo, Chenko | Coqui | Day 1 first 3 hours |
| LibSQL tables created | Everyone | Lucy (compose) + Coqui (Mastra) | Day 1 first 2 hours |
| Linear tools ready | Lalo (workflow) | Coqui | Day 1 afternoon |
| Better Auth working | Chenko (frontend login) | Lucy | Day 1 morning |
| `useChat` endpoint | Chenko | Coqui + Lalo | Day 1 afternoon |
| Langfuse receiving traces | All (evidence) | Lucy | Day 1 evening |
| Wiki generated for Solidus | Lalo (triage agent) | Coqui | Day 1 evening |

---

## Day 1 Timeline (April 8)

### Morning (Hours 0-4)
- **Lucy:** Docker Compose up (all containers), Better Auth setup
- **Coqui:** Mastra runtime running, LibSQL connected, OpenRouter responding
- **Lalo:** Mastra workflow skeleton (intake → triage → ticket steps)
- **Chenko:** TanStack app scaffold, chat UI with `useChat`, multimodal input

### Afternoon (Hours 4-8)
- **Lucy:** Resend email integration, start Langfuse config
- **Coqui:** Linear tools (MCP + SDK), test ticket creation
- **Lalo:** Triage agent with wiki context, severity/priority logic
- **Chenko:** Chat working with real Mastra backend, image paste working

### Evening (Hours 8-12)
- **Integration:** First E2E flow — submit issue in chat → triage → Linear ticket → email notification
- **Coqui:** Start Solidus wiki generation
- **Lucy + Lalo:** Langfuse traces flowing
- **Chenko:** Generative UI ticket cards rendering

## Day 2 (April 9)

### Morning (Hours 12-18)
- **Lalo:** Resolution flow, deduplication, severity scoring
- **Coqui:** Prompt injection guardrails, import users from Linear
- **Lucy + Chenko:** Kanban view from Linear
- **All:** Bug fixes, integration testing

### Afternoon (Hours 18-22)
- **All:** Documentation (README, AGENTS_USE.md, SCALING.md, QUICKGUIDE.md)
- **All:** Evidence capture (Langfuse screenshots, security demo)
- **Stretch:** Slack, Electron wrapper

### Evening (Hours 22-24) — BEFORE 9PM COT
- **All:** Script, record, and upload 3-min YouTube demo
- **All:** Final submission checklist verification
- Deploy to server for potential live demo at awards

## Day 1 Smoke Tests (First 2 Hours)

Before building ANY features, validate in order:
1. ✅ `docker compose up --build` — all containers start
2. ✅ Mastra connects to LibSQL, creates tables
3. ✅ OpenRouter responds with multimodal input (text + image)
4. ✅ Langfuse receives traces from Mastra
5. ✅ Better Auth login works via Drizzle + LibSQL
6. ✅ Linear API creates an issue via `@linear/sdk`

If any fail, fix in hour 1 — not hour 40.
