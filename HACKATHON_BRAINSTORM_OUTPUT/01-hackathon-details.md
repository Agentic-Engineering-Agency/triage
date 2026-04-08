# AgentX Hackathon 2026 — Full Details

## Event Overview
- **Name:** AgentX Hackathon 2026
- **Tagline:** "Build agents that guide R&D forward"
- **Organizer:** SoftServe
- **Format:** Mixed-format engineering challenge for agentic systems

## Timeline
- **Kick-off:** April 7 (Online/On-site)
- **Build Sprint:** April 8-9 (2-day online hack)
- **Submission Deadline:** April 9, 9 PM COT
- **Mentor Pre-screening:** April 10
- **Expert Evaluation:** April 13
- **Awards Ceremony:** April 14 (Online)

## Team & Participation
- **Team Size:** 1-4 members
- **Language:** English B2+
- **Our Team:** Lalo, Lucy, Coqui, Chenko

## Prize Pool
- **1st:** $5,000 | **2nd:** $3,000 | **3rd:** $2,000

## Assignment
Build an **SRE Incident Intake & Triage Agent** for an e-commerce application:
1. Submit report via UI (multimodal: text + image/log/video)
2. Agent triages: extracts details, analyzes code/docs, produces technical summary
3. Creates ticket in ticketing system
4. Notifies technical team (email + communicator)
5. On resolution, notifies original reporter

## Evaluation Criteria
1. **Reliability** — Consistent, handles edge cases
2. **Observability** — Structured logs, traces, metrics across stages
3. **Scalability** — Can handle growth, assumptions documented
4. **Context engineering** — How well agent manages/uses context
5. **Security** — Prompt injection defenses, safe tool usage
6. **Documentation** — Well-documented, clear, reproducible

## Required Deliverables
- README.md, AGENTS_USE.md (9 sections + evidence), SCALING.md, QUICKGUIDE.md
- docker-compose.yml, .env.example, Dockerfile(s), MIT LICENSE
- 3-min YouTube demo in English, tagged #AgentXHackathon

## E-Commerce Codebase
**Solidus** (Ruby on Rails) — https://github.com/solidusio/solidus
- 27K+ commits, 5.3K stars, modular gems (core/backend/api/sample)
- RSpec tests, PostgreSQL
- Chosen over .NET and Node.js options for community activity

## Optional Extras
- Smarter routing or severity scoring
- Deduplication of incidents
- Runbook suggestions
- Observability dashboards
- Team-wide agent configuration
