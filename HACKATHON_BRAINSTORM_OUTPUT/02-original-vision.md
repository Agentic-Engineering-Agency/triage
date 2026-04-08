# Original Vision — "Agentic Engineer" (Session 1)

> This document captures the broader vision brainstormed before the hackathon assignment was revealed.
> Session 2 scoped the hackathon deliverable down to an SRE Incident Triage Agent.
> The ideas below remain relevant as the long-term product vision.

## Core Concept
Multi-agent system that automates the full R&D software lifecycle:
issue → spec → code → test → PR → review → merge → notify

## Key Ideas (13 total)

1. **Hybrid Hub + Pipeline with Phase-Gated HITL** — Human approves planning, dev runs autonomous
2. **Structured Docs + Index-as-Graph + Embeddings** — Project intelligence via markdown wiki
3. **Programmatic Hooks over AI Judgment** — Deterministic validation, not LLM guessing
4. **Self-Improving Skills (Nous Hermes GEPA)** — Agents learn from task outcomes
5. **Mastra + Local Mac + Cloudflare Dynamic Workers** — Two-tier compute
6. **OpenRouter Free Tier** — Zero inference cost strategy
7. **Chat + Kanban (TanStack)** — Separate full-screen pages
8. **Bidirectional GitHub Sync** — GitHub as shared source of truth
9. **Phase Leads + Skill Workers** — Two-tier agent hierarchy
10. **Defense in Depth: Mastra + Nous Hermes** — Cognitive + execution security
11. **Two-Act Pre-Recorded Demo** — Understand, then build
12. **Static Analysis + Unit Tests** — Two-layer quality gate
13. **Tiered Context (Hot/Warm/Cold) + Broadcast** — Context engineering

## What Carried Forward to Hackathon
- Project Intelligence / Wiki (#2) → Solidus codebase understanding
- Mastra orchestration (#5) → Agent runtime
- Defense in Depth (#10) → Security guardrails
- Tiered Context (#13) → Context engineering for triage
- Chat UI (#7) → Incident submission interface
