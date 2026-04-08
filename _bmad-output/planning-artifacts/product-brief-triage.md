---
title: "Product Brief: Triage"
status: "complete"
created: "2026-04-07"
updated: "2026-04-07"
inputs:
  - HACKATHON_CONTEXT/assignment.md
  - HACKATHON_CONTEXT/deliverables.md
  - HACKATHON_CONTEXT/technical_requirements.md
  - HACKATHON_BRAINSTORM_OUTPUT/08-session2-sre-agent.md
  - HACKATHON_BRAINSTORM_OUTPUT/11-tech-stack-final.md
  - HACKATHON_BRAINSTORM_OUTPUT/12-research-findings.md
  - _bmad-output/brainstorming/brainstorming-session-2026-04-07-01.md
---

# Product Brief: Triage

## Executive Summary

Every engineering team has the same broken workflow: something breaks in production, someone files a vague report ("the checkout button doesn't work"), a developer spends 30 minutes trying to reproduce it, another 20 figuring out which part of the codebase is involved, and then manually creates a ticket, assigns it, and pings the team on Slack. Multiply this by dozens of incidents per week and you have engineers spending more time triaging than fixing.

**Triage** is an AI-powered SRE agent that closes this loop automatically. A user describes an incident in natural language — text, screenshots, log files, even video — and Triage's AI agent analyzes the connected codebase, identifies the likely root cause down to specific files and functions, proposes a fix, scores severity, assigns the right engineer, creates a fully detailed ticket in Linear, and notifies the team. When the fix ships, Triage verifies the changes and notifies the original reporter. The entire intake-to-resolution lifecycle — automated, observable, and secure.

Triage is being built for the AgentX Hackathon 2026 as a focused SRE incident agent for e-commerce platforms, starting with Solidus (Ruby on Rails). The long-term vision is a general-purpose incident intelligence platform that works with any codebase, any ticketing system, and any notification channel — turning incident management from a time sink into a competitive advantage.

## The Problem

Incident triage today is a manual, error-prone process that wastes engineering time and delays resolution:

- **Reporters lack technical vocabulary.** A product manager reports "the cart is broken" — but doesn't know if it's a frontend rendering issue, a payment gateway timeout, or a database constraint violation. Engineers play 20 questions to extract useful information.
- **Context switching kills productivity.** The engineer who gets assigned has to context-switch from whatever they were building, read through vague reports, grep through the codebase, and reconstruct what might have happened. This takes 30-60 minutes before any actual fixing begins.
- **Routing is guesswork.** Who should handle this? The backend team? The payments specialist? The person who last touched that file? Without codebase awareness, tickets get bounced between teams.
- **Resolution verification is manual.** When someone marks a ticket "done," nobody systematically checks whether the fix actually addresses the original issue. Reporters often find out their bug is still there weeks later.
- **No institutional memory.** Similar incidents recur because there's no automated deduplication or pattern recognition across past tickets.

The cost is real: engineering teams report spending 15-25% of their time on triage and incident management rather than building features.

## The Solution

Triage replaces the manual triage workflow with an intelligent agent pipeline:

1. **Chat-based incident intake with quick-upload mode.** Users describe issues in natural language through a conversational interface. The agent asks clarifying questions when needed — acting as a copilot, not a form. Supports multimodal input: text, screenshots (paste from clipboard), log files, and video. For developers who just want to dump a stack trace and move on, a quick-upload button triggers auto-triage with no back-and-forth — the agent does its best with what it's given, using the codebase wiki to fill in context automatically.

2. **Codebase-aware triage.** On project setup, Triage auto-generates a comprehensive wiki of the connected codebase using a two-pass analysis (per-file summaries, then cross-module synthesis), with progress indicators and partial results available immediately. When an incident arrives, the agent queries this knowledge base to identify the likely root cause — citing specific files, functions, and code paths — and proposes a solution approach. When confidence is low or the analysis is ambiguous, the agent explicitly flags uncertainty rather than presenting hallucinated file references as fact.

3. **Automated ticket creation with confidence scoring.** Structured output generates a fully detailed ticket in Linear (with Jira and GitHub Issues planned): title, technical summary, root cause analysis with confidence score (e.g., "Root cause confidence: 82%"), proposed fix, severity score, priority level, and auto-assigned to the right team member based on expertise area. When confidence is low, the ticket explicitly flags uncertainty so engineers know to verify before acting.

4. **Multi-channel notification.** Team members are notified via email (Resend) with incident details. Slack integration follows as a secondary channel.

5. **Resolution verification.** When a ticket is marked complete, Triage checks for associated PRs or commits, verifies the changes are relevant to the original issue, and only then notifies the original reporter with a resolution summary. If no evidence of a fix exists, it sends the ticket back for review.

6. **Deduplication and severity scoring.** Before creating a new ticket, Triage checks for similar existing issues and prompts the user to update rather than duplicate. Every ticket receives a consistent severity and priority score based on structured LLM output.

## What Makes This Different

- **Codebase intelligence is the moat, not the chat.** Most incident tools parse text. Triage generates and maintains a living knowledge base of the connected codebase — understanding module boundaries, ownership (who last touched what), service dependencies, and code paths. This is the difference between "ticket filed" and "root cause identified." The wiki layer is the defensible asset; everything else is a UI on top of it.
- **Resolution verification closes the loop.** No other triage tool checks whether the fix actually shipped. Triage's resolution flow verifies PRs/commits and only marks an incident truly resolved when changes are confirmed.
- **Copilot UX, not another form.** Incident reporting through conversation is fundamentally more natural than filling out fields. The agent extracts structure from unstructured input — users describe problems in their own words, and Triage handles the rest.
- **Fully self-hosted and containerized.** Single `docker compose up` — no SaaS dependency for the core product. Your incident data stays on your infrastructure.
- **Observable by design.** Every agent action is traced end-to-end via OpenTelemetry and Langfuse. Full audit trail from intake to resolution.

## Who This Serves

**Primary: Engineering teams (5-50 developers)** working on medium-to-large codebases who handle incident reports from non-technical stakeholders (product managers, QA, customer support). They need triage to be fast, accurate, and not interrupt their flow.

**Secondary: Engineering managers and SRE leads** who want visibility into incident patterns, resolution times, and team workload distribution. The observability layer and Kanban view serve this need.

**Tertiary: Non-technical reporters** (product, support, QA) who need a low-friction way to report issues without learning technical jargon or navigating complex ticketing systems.

## Success Criteria

**Hackathon (immediate):**
- Complete E2E flow demoed: submit → triage → ticket → notify → resolve → notify reporter
- All 6 evaluation criteria addressed with evidence (especially observability and security)
- Clean Docker Compose setup, comprehensive documentation

**Product (6-month horizon):**
- Triage accuracy: >80% of auto-assigned tickets reach the correct engineer on first assignment
- Time-to-triage: <2 minutes from report to fully detailed ticket (vs. 30-60 minutes manual)
- Resolution verification: >90% of "completed" tickets have verified code changes
- Adoption: 3+ teams actively using Triage for daily incident management

## Scope

**Hackathon MVP (April 8-9):**
- Chat-based multimodal incident intake (text + images + files)
- Solidus codebase wiki generation and RAG-based triage
- Linear ticket creation with severity, priority, auto-assignment
- Email notifications (Resend) for team and reporter
- Resolution verification (PR/commit check)
- Deduplication check before ticket creation
- Prompt injection guardrails and security processors
- Full observability via Langfuse
- Docker Compose deployment
- Kanban board (one-way Linear sync)

**Stretch goals (Tier 3, if time allows):**
- Quick-upload auto-triage mode (button that skips conversation)
- Slack notifications
- Jira / GitHub Issues integrations
- Electron/Tauri desktop wrapper
- On-call routing intelligence

**Explicitly NOT in hackathon scope:**
- Auto-fixing code (agents only triage, not code)
- Self-improving agent skills
- Custom skill marketplace
- Mobile app

## Vision: Where This Goes

If Triage succeeds as an incident triage agent, it becomes the entry point for a broader **engineering intelligence platform**:

- **Any codebase, any language.** Wiki generation and RAG extend beyond Ruby on Rails to Python, TypeScript, Go, Java — any project a team connects.
- **Any ticketing system.** Modular integrations: Linear today, Jira, GitHub Issues, Asana, Shortcut tomorrow. Each is a tool swap, not a rewrite.
- **From triage to resolution.** The natural next step: agents that don't just identify the root cause but create a PR to fix it, run tests, and request review. The full lifecycle from Session 1's "Agentic Engineer" vision.
- **Incident pattern recognition and post-incident learning.** Over time, Triage builds a knowledge graph of past incidents, enabling: "This looks like the payment timeout issue from March — here's what fixed it last time." Automatic postmortems and pattern detection across incidents surface systemic issues that individual tickets miss.
- **On-call routing intelligence.** Smart escalation beyond simple assignment: who owns this code, who's on-call, who last touched this file, who resolved a similar incident before.
- **Team intelligence dashboard.** Who handles what? Which modules generate the most incidents? Where are the knowledge gaps? The observability data becomes organizational intelligence.

Triage starts as the fastest path from "something's broken" to "the right person is fixing it." It ends as the system that makes incident management a solved problem.

---

## Pitch Narrative

### The Story Arc

The pitch follows a classic problem → insight → solution → proof structure, designed for a technical audience (hackathon judges evaluating execution quality and production-readiness).

**Act 1: The Problem (30 seconds)**

Open with a scenario every engineer recognizes:

> "It's 2 PM on a Tuesday. A product manager pings your Slack: 'The checkout is broken.' No stack trace. No error code. Just… broken. You stop what you're building, open the repo, start grepping through 27,000 commits of a Rails monolith, and spend the next 45 minutes just figuring out what the problem might be — before you've written a single line of fix. Now multiply that by 15 incidents a week across your team."

The pain points, in order:
1. **Translation gap** — non-technical reporters can't describe technical problems
2. **Context-switching tax** — engineers lose flow state to triage someone else's report
3. **Routing roulette** — tickets bounce between teams because nobody knows who owns what code
4. **Resolution black hole** — tickets get marked "done" with no verification that the fix actually shipped
5. **Amnesia** — the same incident recurs because nobody connected it to the one from last month

**Act 2: The Insight (15 seconds)**

> "The missing piece in every incident management tool is codebase intelligence. PagerDuty alerts you. Jira tracks your tickets. Sentry catches your errors. But none of them actually understand your code — what each module does, who owns it, how it connects to everything else. Without that understanding, triage is just expensive guesswork."

**Act 3: The Solution — Triage (90 seconds)**

Walk through the E2E flow live in the demo:

1. **"Connect your repo."** Show Triage auto-generating a wiki of the Solidus codebase. Time-lapse the two-pass analysis. "In under 2 minutes, Triage has a working understanding of 27,000 commits of Rails code."

2. **"Report an incident."** Type a natural-language report in chat: "Customers are seeing a 500 error on checkout when using PayPal." Paste a screenshot. "The reporter doesn't need to know it's a payment gateway issue. Triage figures that out."

3. **"Watch the triage."** Show the agent querying the wiki, identifying the likely root cause in `solidus_core/app/models/spree/payment.rb`, proposing a fix, scoring severity as High, assigning it to the payments specialist. Confidence score: 87%. "30 seconds from report to fully detailed ticket — with root cause analysis a senior engineer would take 45 minutes to produce."

4. **"Ticket created, team notified."** Show the Linear ticket appearing with all fields populated. Show the email notification arriving. "The right person already has everything they need to start fixing."

5. **"Resolution verified."** Show a ticket being marked complete. Triage checks the PR, confirms the code change addresses the original issue, and emails the reporter: "Your issue has been resolved." "The loop is closed. Not by a human checking a box — by an agent that verified the actual code change."

**Act 4: What Makes This Production-Ready (45 seconds)**

This maps directly to the 6 evaluation criteria — make this explicit:

> "Let me show you why this isn't just a demo."

1. **Reliability** — "The core workflow runs as a Mastra durable workflow with suspend/resume. If the container restarts mid-triage, it picks up exactly where it left off. State is persisted to LibSQL. The deduplication check is programmatic, not an LLM guess — it runs before the agent even sees the ticket."

2. **Observability** — Flash the Langfuse dashboard. "Every agent action — every tool call, every LLM inference, every workflow step — is traced end-to-end with OpenTelemetry. Full correlation IDs from intake to resolution. You can see exactly why the agent made every decision." Show a trace timeline. Show token costs.

3. **Scalability** — "The entire system runs via Docker Compose — 9 containers, single command. But it's designed for Kubernetes: the runtime and database containers scale independently. LibSQL supports primary-replica replication. The Langfuse stack handles its own scaling. We documented the scaling architecture in SCALING.md."

4. **Context Engineering** — "This is the core differentiator. Triage doesn't just parse text — it generates a codebase wiki using a two-pass analysis, stores it as vector embeddings, and queries it with RAG for every incident. The agent knows your codebase. Not generically — specifically. It cites files, functions, and code paths." Show connecting a second repo in 30 seconds to prove generalizability.

5. **Security** — "Every user input passes through Mastra's prompt injection detector before reaching the agent. PII is automatically redacted. System prompt leakage is scrubbed from outputs. All secrets are environment variables — never in context." Show a prompt injection attempt being blocked. "This is evidence, not a description."

6. **Documentation** — "README, AGENTS_USE.md with all 9 sections including evidence screenshots, SCALING.md, QUICKGUIDE.md. Clone, copy .env.example, fill your keys, docker compose up. That's it."

**Closing (15 seconds)**

> "Triage turns incident management from a 45-minute context-switching tax into a 30-second automated pipeline. It doesn't just file tickets — it understands your code, identifies root causes, routes to the right person, and verifies the fix shipped. Today it works with Solidus and Linear. Tomorrow, any codebase, any ticketing system. The architecture is modular — each integration is a tool swap, not a rewrite."

### Hackathon Requirements Map

Every feature maps to at least one evaluation criterion. This is the justification matrix:

| Feature | Evaluation Criteria Addressed | Why It Matters |
|---------|------------------------------|----------------|
| Mastra durable workflows (suspend/resume/persist) | **Reliability** | Survives restarts, handles edge cases, retries on failure |
| Multimodal input (text + image + files) | **Reliability** | Required by assignment. Supports the actual way people report bugs |
| Codebase wiki generation (llm-wiki + RAG) | **Context Engineering** | THE differentiator. Agent understands the codebase, not just the text |
| Structured output (Zod schemas for tickets) | **Reliability** | Consistent, typed output — no unstructured LLM randomness |
| Confidence scoring on root cause | **Reliability** | Honest about uncertainty. Wrong file references are worse than none |
| Deduplication (programmatic, pre-LLM) | **Reliability** | Deterministic check, not LLM guess. Prevents ticket flooding |
| Langfuse traces (all agent actions) | **Observability** | End-to-end trace from intake to resolution with correlation IDs |
| Token cost tracking | **Observability** | Know exactly what each triage costs |
| Prompt injection detector (Mastra processor) | **Security** | Blocks malicious input before it reaches the agent |
| PII redaction (Mastra processor) | **Security** | Sensitive data never reaches the LLM or logs |
| System prompt scrubber | **Security** | Prevents prompt extraction attacks |
| DOMPurify + Helmet.js | **Security** | XSS prevention, HTTP security headers |
| Docker Compose (9 containers) | **Scalability** | Reproducible, sandboxed, portable |
| LibSQL primary/replica replication | **Scalability** | Read scaling documented in SCALING.md |
| Kubernetes-ready container architecture | **Scalability** | Separate stateless (runtime) and stateful (DB) for elastic scaling |
| README, AGENTS_USE.md, SCALING.md, QUICKGUIDE.md | **Documentation** | All required files, with evidence in sections 6 and 7 |
| Resolution verification (PR/commit check) | **Reliability** | Closes the loop — no "done" without proof |
| Email notifications (Resend) | **Reliability** | Real integration, not mocked (with mocked fallback) |
| Linear integration (create/read/update issues) | **Reliability** | Real integration via `@linear/sdk` + MCP |
| Better Auth (self-hosted) | **Security** | Authentication without external dependency |
| Severity scoring (structured output) | **Reliability** | Consistent classification for prioritization |

### AGENTS_USE.md Section Mapping

The 9 required sections map to our architecture as follows:

| AGENTS_USE.md Section | What We Show |
|----------------------|--------------|
| 1. Agent Overview & Tech Stack | Mastra + AI SDK + LibSQL + Langfuse + TanStack. OpenRouter (Qwen 3.6+). Docker Compose. |
| 2. Agents & Capabilities | Orchestrator (routing, batch), Triage Agent (RAG + analysis + structured output), Resolution Reviewer (PR verification) |
| 3. Architecture & Orchestration | Mastra workflows: intake → triage → dedup → ticket → notify → suspend → verify → notify. Diagram included. Error handling: retry transient, log permanent, human escalation. |
| 4. Context Engineering | llm-wiki two-pass codebase analysis → LibSQL F32_BLOB vectors → RAG query per incident. Tiered: hot (current task), warm (wiki index), cold (git history). |
| 5. Use Cases | Walkthrough: non-technical report → triage → ticket → notify → resolve → verify → close. Batch submission. Duplicate detection. Failed verification. |
| 6. Observability (EVIDENCE) | Langfuse screenshots: trace timelines, span trees, token costs, correlation IDs. Structured logs. |
| 7. Security (EVIDENCE) | Screenshots: prompt injection blocked, PII redacted, system prompt scrub. Mastra processor configs. |
| 8. Scalability | Docker Compose → Kubernetes. Container separation (stateless runtime, stateful DB). LibSQL replication. |
| 9. Lessons Learned | Team reflections compiled from development session logs. What worked, what we'd change, trade-offs. |
