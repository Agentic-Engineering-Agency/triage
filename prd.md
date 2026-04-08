---
stepsCompleted: ['step-01-init', 'step-01b-continue', 'step-02-discovery', 'step-02b-vision', 'step-02c-executive-summary', 'step-03-success', 'step-04-journeys', 'step-05-domain', 'step-06-innovation']
classification:
  projectType: web_app
  domain: devops_sre
  complexity: medium-high
  projectContext: greenfield
inputDocuments:
  - _bmad-output/planning-artifacts/product-brief-triage.md
  - _bmad-output/planning-artifacts/product-brief-triage-distillate.md
  - _bmad-output/brainstorming/brainstorming-session-2026-04-07-01.md
  - _bmad-output/planning-artifacts/handoff-prompt-prd.md
  - HACKATHON_CONTEXT/assignment.md
  - HACKATHON_CONTEXT/deliverables.md
  - HACKATHON_CONTEXT/technical_requirements.md
  - HACKATHON_CONTEXT/official_rules.md
  - HACKATHON_CONTEXT/AGENTS_USE.md
  - HACKATHON_CONTEXT/resources_for_hackathon.md
  - HACKATHON_BRAINSTORM_OUTPUT/08-session2-sre-agent.md
  - HACKATHON_BRAINSTORM_OUTPUT/09-team-assignments-v2.md
  - HACKATHON_BRAINSTORM_OUTPUT/10-risk-matrix.md
  - HACKATHON_BRAINSTORM_OUTPUT/11-tech-stack-final.md
  - HACKATHON_BRAINSTORM_OUTPUT/12-research-findings.md
  - HACKATHON_BRAINSTORM_OUTPUT/13-linear-tasks.md
  - HACKATHON_BRAINSTORM_OUTPUT/01-hackathon-details.md
  - HACKATHON_BRAINSTORM_OUTPUT/02-original-vision.md
documentCounts:
  briefs: 2
  research: 1
  brainstorming: 1
  hackathonContext: 6
  brainstormOutput: 8
  projectDocs: 0
workflowType: 'prd'
---

# Product Requirements Document - Triage

**Author:** Fr
**Date:** 2026-04-07

## Executive Summary

Engineering teams spend 15-25% of their time on incident triage — not fixing bugs, but figuring out what's broken, where in the codebase it lives, and who should handle it. A product manager reports "the checkout is broken." A developer stops what they're building, spends 30-60 minutes grepping through the repo, reconstructs the probable cause, manually creates a ticket, assigns it, and pings the team. Resolution verification is nonexistent: tickets get marked "done" with no check that the fix actually shipped.

**Triage** is an AI-powered SRE agent that automates the entire incident lifecycle — from intake to verified resolution. Users describe incidents in natural language through a chat interface, attaching screenshots, log files, or video. Triage's agent analyzes a pre-generated knowledge base of the connected codebase (starting with Solidus, a Ruby on Rails e-commerce platform), identifies the likely root cause down to specific files and functions, scores severity, assigns the right engineer, creates a fully detailed ticket in Linear, and notifies the team via email. When the fix ships, Triage verifies the associated PR/commits against the original issue and notifies the reporter. The full intake-to-resolution loop — automated, observable, and secure.

Built for the AgentX Hackathon 2026 (April 8-9, 4-person team, 48-hour sprint), Triage targets all six evaluation criteria: Reliability (Mastra durable workflows with suspend/resume), Observability (end-to-end Langfuse traces), Scalability (9-container Docker Compose, Kubernetes-ready), Context Engineering (llm-wiki codebase RAG), Security (prompt injection detection, PII redaction), and Documentation (README, AGENTS_USE.md with evidence, SCALING.md, QUICKGUIDE.md). The architecture is modular — each integration (Linear, Resend, OpenRouter) is a tool swap, not a rewrite — positioning Triage for post-hackathon extension to any codebase, any ticketing system, any notification channel.

### What Makes This Special

**Codebase intelligence is the moat.** Every incident management tool on the market — PagerDuty, Jira AI features, Sentry — operates on text and metadata. None of them understand the actual codebase. Triage generates a living knowledge base using a two-pass llm-wiki approach (per-file summaries, then cross-module synthesis), stores it as vector embeddings in LibSQL, and queries it via RAG for every incident. This is the difference between "ticket filed" and "root cause identified with file references and a proposed fix at 87% confidence."

**Resolution verification closes the loop.** No other triage tool checks whether the fix actually shipped. Triage's resolution flow verifies PRs/commits against the original issue and only marks an incident resolved when code changes are confirmed. No evidence of a fix → ticket goes back to review.

**Copilot UX, not another form.** Incident reporting through conversation is fundamentally lower-friction than filling out fields. The agent extracts structure from unstructured input — users describe problems in their words, Triage handles the translation to technical artifacts.

**No competitive overlap.** PagerDuty routes alerts. Jira tracks tickets. Sentry catches errors. CodeRabbit reviews PRs. None do multimodal intake → codebase-aware triage → ticket creation → resolution verification in one tool.

## Project Classification

- **Project Type:** Web application (SPA) — TanStack Router + AI SDK `useChat` frontend, Mastra agent orchestration backend, LibSQL database with native vector search
- **Domain:** DevOps / SRE — incident management and triage automation for engineering teams (5-50 developers)
- **Complexity:** Medium-High — multi-agent AI orchestration, durable workflows with suspend/resume, codebase RAG via llm-wiki, multimodal LLM input, external integrations (Linear, Resend, OpenRouter), 9-container Docker architecture
- **Project Context:** Greenfield — built from scratch for AgentX Hackathon 2026. 4 developers (Lalo, Lucy, Coqui, Chenko), ~55 hours, AI-assisted development

## Success Criteria

### User Success

- **Non-technical reporters** can describe an incident in their own words (text + screenshot) and receive a fully triaged, assigned ticket within 60 seconds — no technical vocabulary required
- **Engineers** receive tickets with root cause analysis citing specific files/functions, a proposed fix, and severity scoring — eliminating the 30-60 minute context-switching tax of manual triage
- **Engineering managers** gain visibility into incident patterns, resolution times, and team workload through the Kanban view and Langfuse observability dashboard
- **Original reporters** receive a resolution notification confirming the fix shipped — the loop is closed without them having to follow up

### Business Success

**Hackathon (April 8-9):**
- Complete E2E flow demonstrated: submit → triage → ticket → notify → resolve → verify → notify reporter
- All 6 evaluation criteria addressed with concrete evidence (especially Observability and Security with screenshots in AGENTS_USE.md sections 6 and 7)
- Clean `docker compose up --build` from scratch, comprehensive documentation (README, AGENTS_USE, SCALING, QUICKGUIDE)
- 3-minute YouTube demo covers full flow with production-readiness proof points

**Product (6-month horizon):**
- Triage accuracy: >80% of auto-assigned tickets reach the correct engineer on first assignment
- Time-to-triage: <2 minutes from report to fully detailed ticket (vs. 30-60 minutes manual)
- Resolution verification: >90% of "completed" tickets have verified code changes before reporter notification
- Adoption: 3+ engineering teams actively using Triage for daily incident management

### Technical Success

- **Reliability:** Mastra durable workflows survive container restarts (suspend → restart → resume). Deduplication is programmatic, not LLM-guessed. Structured output via Zod schemas ensures consistent ticket format.
- **Observability:** Every agent action traced end-to-end in Langfuse with correlation IDs from intake to resolution. Token costs tracked per triage. Trace timelines visible in dashboard.
- **Scalability:** 9-container Docker Compose architecture with documented Kubernetes scaling path. LibSQL supports primary/replica replication. Stateless runtime scales independently from stateful DB.
- **Context Engineering:** Codebase wiki generated via two-pass llm-wiki, stored as F32_BLOB vectors in LibSQL, queried via RAG for every incident. Confidence scoring flags low-certainty results.
- **Security:** Prompt injection blocked before reaching agent. PII redacted from LLM context and logs. System prompt scrubbed from outputs. All secrets via environment variables only.
- **Documentation:** All required files present and complete. AGENTS_USE.md sections 6 and 7 contain evidence screenshots.

### Measurable Outcomes

| Metric | Target | Measurement |
|--------|--------|-------------|
| Incident-to-ticket time | <60 seconds | Langfuse trace duration (intake → ticket created) |
| Root cause accuracy | >80% correct file/module identification | Manual review of first 50 triages against Solidus codebase |
| Assignment accuracy | >80% correct engineer on first assignment | Track reassignment rate in Linear |
| Resolution verification rate | >90% of "done" tickets have verified code changes | Workflow completion logs |
| Duplicate detection | >70% of true duplicates caught before ticket creation | Compare created tickets against known duplicate pairs |
| Confidence calibration | Confidence score correlates with accuracy | Plot confidence vs. correctness across triages |

## Product Scope

### MVP - Hackathon (Must Ship)

- Chat-based multimodal incident intake (text + image paste + file upload)
- Solidus codebase wiki generation (llm-wiki two-pass) and RAG-based triage
- Structured triage output: title, technical summary, root cause (with confidence score), proposed fix, severity, priority, assignee
- Linear ticket creation with all fields populated
- Email notifications via Resend (team assignment + reporter resolution)
- Resolution verification (PR/commit check against original issue)
- Deduplication check before ticket creation (programmatic, pre-LLM)
- Prompt injection detection + PII redaction (Mastra processors)
- Full Langfuse observability (traces, spans, token costs)
- Docker Compose deployment (9 containers, single command)
- Kanban board (one-way Linear sync, read-only)
- Better Auth (email/password, self-hosted)
- All required documentation files

### Growth Features (Post-MVP / Tier 3 Stretch)

- Quick-upload auto-triage mode (skip conversation, dump stack trace + go)
- Slack notifications
- Jira and GitHub Issues integrations (modular tool swaps)
- Electron/Tauri desktop wrapper
- On-call routing intelligence (who's on-call, who last touched this file)
- json-render full layout composition for dynamic ticket dashboards

### Vision (Future)

- Any codebase, any language (Python, TypeScript, Go, Java — not just Rails)
- Incident pattern recognition and automatic postmortems across past tickets
- Agents that create fix PRs, run tests, and request review (triage → resolution)
- Team intelligence dashboard (who handles what, which modules generate most incidents, knowledge gaps)
- PagerDuty/Opsgenie integration as upstream data sources
- Self-improving agent skills via task outcome feedback loops

## User Journeys

### Journey 1: Maria the PM — "The Checkout Is Broken" (Primary Reporter, Happy Path)

Maria is a product manager at an e-commerce company running Solidus. It's Tuesday at 2 PM. A customer support ticket just came in: checkout fails on mobile when paying with PayPal. Maria doesn't know if it's frontend, backend, or the payment gateway. She just knows it's broken and customers are leaving.

**Before Triage:** Maria would ping the engineering Slack channel with "checkout broken on mobile + PayPal, help?" — then wait 20 minutes for someone to respond, answer 5 clarifying questions she can't fully answer, and hope the right person picks it up. Total time from report to someone actually investigating: 45-90 minutes.

**With Triage:** Maria opens the chat interface. Types: "Customers are getting a 500 error on checkout when using PayPal on mobile." Pastes a screenshot from the support ticket showing the error page. Triage's agent asks one clarifying question: "Is this happening for all payment methods or only PayPal?" Maria answers "Only PayPal." Within 30 seconds, the agent has queried the Solidus wiki, identified `solidus_core/app/models/spree/payment.rb` as the likely root cause (PayPal gateway timeout in the payment processing flow), proposed a fix (add retry logic with exponential backoff), scored severity as **High** (feature broken for a payment method), and assigned it to Diego — the engineer who last touched the payments module.

A Linear ticket appears in chat as a rich card: title, technical summary, confidence score (87%), severity badge, assigned engineer. Maria doesn't need to understand the technical details — they're there for Diego. Simultaneously, Diego receives an email with the full triage.

Two hours later, Diego pushes a fix. He marks the ticket complete in Linear. Triage checks PR #247, confirms the diff touches the files from the original triage, and emails Maria: "Your reported issue has been resolved. Changes: added PayPal gateway retry logic with 3-attempt backoff in payment processing. PR #247 merged."

Maria never had to follow up. The loop closed itself.

### Journey 2: Carlos the Developer — Stack Trace Quick Drop (Primary User, Edge Case)

Carlos is a backend engineer. His monitoring just caught an `ActiveRecord::RecordNotFound` in `Spree::OrdersController#show`. He doesn't need a conversation — he already knows what happened, he just needs it tracked and triaged properly.

Carlos opens Triage, pastes the full stack trace into chat, and hits send. No back-and-forth. The agent recognizes this as a developer-submitted incident, skips clarifying questions, and goes straight to analysis. It queries the Solidus wiki, identifies the order lookup failure in `solidus_core/app/controllers/spree/orders_controller.rb`, cross-references with the order scoping logic, and proposes: "Check order scope — user-visible orders may exclude incomplete orders that the controller is trying to display."

Confidence: 91%. Severity: Medium (degraded experience, not system-down). Auto-assigned to Carlos himself since he's the one who reported it and has backend expertise. Linear ticket created. Carlos clicks through to Linear and starts fixing.

**Reveals:** The system must handle both conversational (Maria) and direct-submission (Carlos) input styles. Developer-submitted incidents with stack traces should minimize unnecessary back-and-forth.

### Journey 3: Sofia the Support Lead — Batch Incident Submission

Sofia manages the customer support team. After the Monday morning support queue review, she has three separate customer issues to escalate to engineering:

1. "Search results are slow on the catalog page"
2. "Tax calculation is wrong for orders shipping to Colombia"
3. "Product images aren't loading on the category page"

Sofia opens Triage and types all three in a single message. The orchestrator agent recognizes this as a batch submission, splits into three parallel triage branches, and processes each independently. Within 90 seconds, three Linear tickets appear in chat — each with its own triage analysis, severity, and assignee. The search issue goes to the backend team (Medium severity), the tax calculation goes to the orders specialist (High severity — financial impact), and the image loading goes to the frontend team (Medium severity).

Three emails go out to three different engineers. Sofia's done. What used to take her 30 minutes of separate ticket filing with incomplete technical details is now handled in under 2 minutes with full root cause analysis on each.

**Reveals:** Batch processing requires parallel workflow execution. The orchestrator must detect multi-issue submissions and split them without user intervention.

### Journey 4: Diego the Engineer — Duplicate Detection and Resolution Verification

Diego receives Maria's PayPal checkout ticket from Journey 1. But before he starts, another PM reports: "payment page is crashing for international orders." Triage detects semantic similarity with Maria's existing ticket (PayPal gateway timeout) and prompts the second reporter: "Found similar issue: 'PayPal gateway 500 error on mobile checkout' — would you like to update the existing ticket with this new context, or create a separate issue?" The reporter chooses to update. Diego now has one enriched ticket instead of two duplicates.

Diego fixes the issue, creates PR #247, and marks the ticket Done in Linear. The Linear webhook triggers Triage's resolution flow: the workflow resumes, checks for associated PRs, finds PR #247, analyzes the diff against the original triage. The changes touch `spree/payment.rb` — confirmed match. Triage emails both Maria and the second reporter with a resolution summary.

**But what if Diego marks it done without a PR?** Triage checks for code changes and finds nothing. It adds a comment to the Linear ticket: "No code changes detected for this issue. Please link the relevant PR or describe what was done." The ticket moves back to In Review. The loop doesn't close until there's evidence.

**Reveals:** Deduplication must happen before ticket creation (programmatic check). Resolution verification must handle both PR-based and direct-push workflows. Failed verification must gracefully push back.

### Journey 5: Lucy the Platform Admin — Project Setup and Wiki Generation

Lucy is setting up Triage for a new codebase. She logs in with her Better Auth credentials, navigates to project settings, and connects the Solidus GitHub repository. Triage immediately begins the wiki generation process: two-pass analysis (per-file summaries, then cross-module synthesis) with a progress indicator showing which modules are being analyzed.

While the wiki generates (~2-3 minutes for Solidus core), Lucy imports team members from Linear. The system pulls names, emails, and roles. Lucy fills in missing details via chat: "Diego specializes in payments and backend. Carlos handles the order pipeline. Fernanda does frontend and catalog."

Wiki generation completes. Lucy can now see the codebase knowledge base — structured summaries of payment flows, order state machines, inventory management, API endpoints. Triage is ready to accept incidents for this project.

**Reveals:** Project setup requires repo connection, wiki generation with progress feedback, team member import, and expertise mapping. This is a one-time setup per project, not a per-incident flow.

### Journey Requirements Summary

| Journey | Key Capabilities Revealed |
|---------|--------------------------|
| Maria (PM Reporter) | Chat-based multimodal input, copilot-style clarifying questions, structured triage output, auto-assignment by expertise, email notifications, resolution verification with reporter notification |
| Carlos (Developer) | Direct stack trace submission, minimal-conversation mode, self-assignment awareness, developer-optimized triage output |
| Sofia (Batch) | Multi-issue detection, parallel triage workflows, independent assignment per issue, batch notification |
| Diego (Dedup + Resolution) | Semantic duplicate detection, ticket enrichment, resolution verification (PR/commit check), failed verification recovery, multi-reporter notification |
| Lucy (Admin Setup) | Repo connection, wiki generation with progress, Linear user import, expertise mapping, project configuration |

## Innovation & Novel Patterns

### Detected Innovation Areas

**1. Codebase-Aware Incident Triage (Primary Innovation)**
No existing incident management tool bridges the gap between human-reported symptoms and codebase-level root cause analysis. Triage combines a llm-wiki knowledge base (two-pass: per-file summaries → cross-module synthesis) with RAG-based querying to produce root cause analysis that cites specific files, functions, and code paths. This is fundamentally different from text classification or keyword routing — it's semantic understanding of an entire codebase applied to incident intelligence.

**2. Automated Resolution Verification (Novel Pattern)**
The incident management loop today is open-ended: someone marks a ticket "done" and everyone hopes it's true. Triage's resolution flow programmatically verifies that code changes (PRs/commits) match the original triage before notifying the reporter. This is a novel closed-loop pattern — no competitor implements it.

**3. Conversational Multimodal Intake → Structured Technical Output**
The translation from "the checkout is broken" + a screenshot to a fully structured ticket with root cause analysis, confidence scoring, severity classification, and auto-assignment is a novel AI agent pipeline. Existing tools either accept structured input (forms) or produce unstructured output (chat). Triage does unstructured-in, structured-out with codebase grounding.

**4. Durable Agent Workflows with Human-in-the-Loop Suspension**
Using Mastra's suspend/resume pattern to create workflows that pause mid-execution (waiting for ticket resolution via webhook), persist state to LibSQL, survive container restarts, and resume exactly where they left off. This is a production-grade pattern that most hackathon projects skip.

### Market Context & Competitive Landscape

| Tool | What It Does | What It Doesn't Do |
|------|-------------|-------------------|
| PagerDuty / Opsgenie | Alert routing and escalation | No codebase understanding, no intake from humans |
| Jira / Linear AI features | Auto-categorization, summaries | No root cause analysis, no codebase awareness |
| Sentry / Datadog | Error detection and monitoring | Not incident intake — upstream data source, not triage |
| CodeRabbit / Sourcery | Code review automation | Different workflow — reviews PRs, not incidents |

**Gap:** No tool does multimodal intake → codebase-aware triage → ticket creation → resolution verification in one integrated pipeline. Triage occupies this gap.

### Validation Approach

- **Hackathon demo (immediate):** Live E2E flow against Solidus codebase — submit incident, show root cause analysis with file references, verify ticket quality, demonstrate resolution verification
- **Connect second repo (30 seconds):** Prove generalizability by connecting a non-Solidus codebase during demo, showing wiki generation works on any repo
- **Confidence calibration:** Track whether confidence scores correlate with actual accuracy across demo triages
- **Judge criteria mapping:** Every innovation maps to at least one of the 6 evaluation criteria (see Hackathon Requirements Map in product brief)

### Risk Mitigation

| Innovation Risk | Mitigation |
|----------------|------------|
| Wiki generation too slow for demo | Pre-generate Solidus wiki before recording. Scope to `solidus_core` if needed. |
| Root cause accuracy too low | Confidence scoring makes uncertainty explicit. Low-confidence triages flag themselves rather than hallucinating file references. |
| RAG retrieval misses relevant context | Fallback: agent can search wiki with broader queries. Wiki quality directly impacts triage quality — invest in two-pass generation. |
| Resolution verification too rigid | Handle both PR-based and direct-push workflows. "No evidence" triggers graceful push-back, not hard failure. |
| Free LLM tier unreliable | OpenRouter has internal fallback routing. Multiple backup providers configured (Groq, Gemini, paid OpenRouter). One env var change to switch. |
