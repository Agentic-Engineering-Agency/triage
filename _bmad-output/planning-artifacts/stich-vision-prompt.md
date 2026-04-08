# Stich Vision Prompt — Triage Frontend

> Quick design exploration. Goal: generate a visual concept we can react to, find insights, and discover blind spots. This is NOT the final spec — it's a vision prototype to inform the real PRD and UX design that come next.

---

## What is Triage?

An AI-powered SRE agent that automates incident management for engineering teams. A user reports a bug in natural language (with screenshots, logs, etc.), and the AI analyzes the connected codebase, identifies the root cause down to specific files, creates a detailed ticket in Linear, notifies the team, and verifies the fix when it ships.

**Core flow:** Report incident → AI triages → Ticket created → Team notified → Fix shipped → AI verifies → Reporter notified

## Tech Constraints

- **Framework:** TanStack (Router + Query) — SPA, client-side routing
- **Components:** shadcn/ui (Radix primitives + Tailwind)
- **Chat engine:** Vercel AI SDK `useChat` hook — streaming responses
- **Generative UI:** AI renders rich cards (ticket previews, severity badges, file references) inline in chat via tool-based rendering
- **Auth:** Better Auth (email/password, session-based)
- **Theme:** Dark-first (SRE/dev tooling aesthetic), professional, information-dense

## The 4 Screens

### 1. Chat Page (PRIMARY — 70% of the experience)

This is the core. Users report incidents here by talking to the AI agent.

**Key interactions:**
- Natural language input with multimodal support: paste screenshots (clipboard), drag files (logs, stack traces), attach video
- AI responds with streaming text + rich inline cards:
  - **Triage card:** root cause analysis with file references, confidence score (e.g. "87%"), severity badge, proposed fix
  - **Ticket card:** Linear ticket preview (title, assignee, priority, status) with a link
  - **Notification card:** confirmation that team was notified
- Quick-upload button: "just dump files and auto-triage, no conversation" — for devs who don't want to chat
- Conversation history in sidebar or panel
- The AI may ask clarifying questions before triaging

**Design insight questions to explore:**
- How do we make multimodal input feel effortless (not a clunky upload form)?
- How should confidence scores and severity be visually communicated?
- How do generative UI cards sit alongside regular chat messages without breaking flow?
- What happens when the AI is uncertain? How does that look different from a confident triage?

### 2. Kanban Board Page

One-way sync from Linear — read-only view of all tickets Triage has created.

**Key elements:**
- Columns: Backlog → Triage → In Progress → Review → Done
- Ticket cards show: title, severity badge, assignee avatar, confidence score, age
- Click to expand: full triage details, root cause, proposed fix, timeline
- Filter by: severity, assignee, project, date range
- Visual indicator for tickets awaiting verification (suspended workflow)

**Design insight questions:**
- How do we differentiate AI-created tickets from human-created ones?
- How should the "awaiting verification" state be shown — it's a unique Triage concept?

### 3. Project Setup / Dashboard Page

Where users connect a codebase and see project health.

**Key elements:**
- Connect repo (GitHub URL input) → shows wiki generation progress (two-pass analysis with progress bar)
- Project cards: repo name, last wiki update, # of incidents, team members
- Quick stats: avg triage time, resolution rate, top incident areas
- Team member list (imported from Linear) with expertise areas

**Design insight questions:**
- How do we make wiki generation feel fast/valuable (it takes ~2 min for a large repo)?
- What does "codebase intelligence" look like visually — can we show the AI's understanding?

### 4. Auth Pages (Login / Register)

Clean, minimal. Email + password. The product name and a one-liner.

---

## Design Direction

- **Information density:** This is a dev tool, not a consumer app. Engineers want data, not whitespace. Think Linear, Grafana, Sentry — not Notion.
- **Dark mode first:** Deep backgrounds, high-contrast text, color-coded severity (red/orange/yellow/blue for critical/high/medium/low)
- **Status is king:** Every ticket, every triage, every workflow has a state. Make states visually scannable.
- **Trust through transparency:** Show the AI's confidence, show the files it referenced, show the trace. Engineers trust tools they can verify.
- **Speed:** The whole point is that triage is fast. The UI should feel fast — minimal loading states, streaming text, instant feedback.

## Color Palette

| Token | Hex | Role |
|-------|-----|------|
| Primary / Teal | `#45AAB8` | Brand accent, links, active states, interactive elements |
| Accent / Gold | `#E1D772` | Warnings, highlights, medium severity, hover states |
| Light / Cream | `#FAF4B1` | High-contrast text on dark, notification badges, spotlight |
| Base / Charcoal | `#394240` | Backgrounds, surfaces, cards — the dark canvas |
| Alert / Coral | `#F06B50` | Errors, critical severity, destructive actions, urgent badges |

### Severity Mapping

| Level | Color | Token |
|-------|-------|-------|
| Critical | `#F06B50` Coral | Alert — production down, data loss |
| High | `#E1D772` Gold | Accent — major feature broken |
| Medium | `#45AAB8` Teal | Primary — degraded experience |
| Low | `#FAF4B1` Cream | Light — cosmetic, minor |

## What We Want From This Vision

1. **A visual concept** of all 4 screens — enough fidelity to see the layout, hierarchy, and flow
2. **Surface blind spots** — what are we missing? What interactions haven't we thought about?
3. **Explore the chat + generative UI pattern** — this is the hardest design problem. How do rich triage cards coexist with conversational flow?
4. **Give us something to react to** — we'll iterate from here into a full UX spec

Export as HTML so we can view it in a browser and share with the team.
