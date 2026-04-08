# Deliverables

Each team must submit the following by the deadline (see FAQ #1 in #faq for timezone details).

---

## 1. Solution Introduction

A brief text (2–3 paragraphs) introducing your solution, the problem it addresses, and your approach.

---

## 2. Demo Video

A publicly published YouTube video (maximum 3 minutes) demonstrating the full end-to-end flow of your agent:

submit → triage → ticket created → team notified → resolved → reporter notified

Tag it with **#AgentXHackathon** in the title or description.

---

## 3. Public Git Repository

A public Git repository licensed under MIT. The repo must include:

- **README.md** — architecture overview, setup instructions, and project summary
- **AGENTS_USE.md** — agent documentation: use cases, implementation details, observability evidence, and safety measures (reference: https://docs.anthropic.com/en/docs/agents-use-md)
- **SCALING.md** — explanation of how the application scales, including assumptions and technical decisions
- **QUICKGUIDE.md** — step-by-step instructions to run and test the application
- **docker-compose.yml** — the application must run via Docker Compose
- **.env.example** — all required environment variables with placeholders and comments
- **LICENSE** — MIT

For full technical details on each file, see the **Technical Requirements** post in this channel.

---

## Optional Extras

These are not required but are welcome and will be considered during evaluation:

- Smarter routing or severity scoring
- Deduplication of incidents
- Runbook suggestions
- Observability dashboards
- Team-wide agent configuration (skills, cursor rules, AGENTS.md, sub-agents, etc.)

---

## Submission Checklist

Before submitting, confirm:

- 🟡   Solution introduction is written
- 🟡  Demo video is published on YouTube, in English, max 3 minutes, tagged #AgentXHackathon
- 🟡  Repository is public with MIT License
- 🟡  All required files are present (README, AGENTS_USE.md, SCALING.md, QUICKGUIDE.md, docker-compose.yml, .env.example)
- 🟡  Application builds and runs with `docker compose up --build`

Incomplete submissions will not be evaluated.