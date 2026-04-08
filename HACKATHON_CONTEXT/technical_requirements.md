# Technical Requirements for Submission

To ensure consistent evaluation across all teams, each submission must meet the following technical requirements.

---

## Required Repository Structure

Each repository must include the following files:

- **README.md** — architecture overview, setup instructions, and project summary
- **AGENTS_USE.md** — agent documentation, including use cases, implementation details, observability evidence, and safety measures
- **SCALING.md** — explanation of how the application scales, including the team's assumptions and technical decisions
- **QUICKGUIDE.md** — simple step-by-step instructions to run and test the application, ideally in the format: clone → copy `.env.example` → fill keys → `docker compose up --build`. OpenRouter support should be included if applicable
- **docker-compose.yml** — mandatory; the entire application must run through Docker Compose and expose only the required ports
- **.env.example** — all required environment variables, with placeholder values and comments
- **Dockerfile(s)** — referenced by `docker-compose.yml`
- **LICENSE** — the repository must be public and licensed under MIT

---

## Docker Requirement

Docker Compose is mandatory for all submissions.

Although we do not need to run every application during evaluation, Docker is required because it:

- ensures consistent and reproducible execution regardless of the technology stack
- provides a safer, sandboxed environment for code review and validation
- allows resource limits and network restrictions to be applied during evaluation if needed
- gives the review team a standard structure across all projects

The project must build and run from a clean environment using:

```
docker compose up --build
```

No host-level dependencies should be required beyond Docker Compose.

---

## Acceptable Implementation Scope

Participants may use mocked integrations where needed. This includes systems such as:

- ticketing platforms
- email systems
- communication tools

Mocked components are acceptable if the end-to-end flow is clearly demoable.

---

## Demo Video Requirements

Each submission must include a demo video that meets the following requirements:

- **Language:** English
- **Maximum length:** 3 minutes
- **Platform:** YouTube
- **Required tag:** #AgentXHackathon

The video should clearly demonstrate the value of the solution and show the main flow of the application.

---

## Important Notes for Participants

Before submitting, make sure your project satisfies the following:

- the repository is public
- the repository includes an MIT License
- the required files are present and complete
- the application can be built and run using `docker compose up --build`
- only necessary ports are exposed
- all required environment variables are documented in `.env.example`
- the demo video is published on YouTube and includes #AgentXHackathon

---

## Why These Requirements Exist

These requirements are designed to make submissions:

- easier to review
- more consistent across teams
- safer to evaluate
- easier to understand without requiring full execution

For security and consistency reasons, we do not rely on running every application during review. However, we still require a standardized, runnable structure to ensure fairness and technical completeness.