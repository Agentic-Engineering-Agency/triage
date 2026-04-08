# Triage — SRE Incident Triage Agent

> Intelligent incident triage powered by AI agents. Built for the AgentX Hackathon 2026.

<img src="docs/diagrams/architecture-overview.svg" alt="Architecture Overview" />

## Architecture

```mermaid
graph TD
    Browser["Browser :3001"] -->|HTTPS| frontend["frontend :3001"]
    frontend -->|proxy| runtime["runtime :4111"]
    runtime -->|SQL| libsql["libsql :8080"]
    runtime -->|traces| langfuse-web["langfuse-web :3000"]
    langfuse-web --> langfuse-worker["langfuse-worker :3030"]
    langfuse-worker --> clickhouse["clickhouse :8123"]
    langfuse-worker --> redis["redis :6379"]
    langfuse-worker --> minio["minio :9090"]
    langfuse-web --> langfuse-postgres["langfuse-postgres :5432"]
```

## Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/your-org/triage.git
cd triage

# 2. Configure environment
cp .env.example .env
# Edit .env and replace CHANGEME values

# 3. Start all services
docker compose up --build
```

Open [http://localhost:3001](http://localhost:3001) to access the Triage dashboard.

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Agent Framework | Mastra | 1.23 |
| Database | LibSQL | latest |
| ORM | Drizzle | latest |
| Auth | Better Auth | latest |
| Observability | Langfuse | v3 |
| LLM Gateway | OpenRouter | latest |
| Frontend Router | TanStack Router | latest |
| AI Toolkit | AI SDK | latest |
| Reverse Proxy | Caddy | latest |
| UI Components | shadcn/ui | latest |

## Team Credits

| Name | Role |
|------|------|
| **Lalo** | Lead & Agents |
| **Lucy** | Infrastructure |
| **Coqui** | Runtime & Integrations |
| **Chenko** | Frontend |

Built with love for the AgentX Hackathon 2026.

## License

[MIT](./LICENSE)
