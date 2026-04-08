# Quick Guide — Get Triage Running in 5 Minutes

## Step 1: Clone the Repository

```bash
git clone https://github.com/your-org/triage.git
cd triage
```

> Already have a clone? Skip this step and pull the latest changes instead:
> ```bash
> git pull origin main
> ```

## Step 2: Configure Environment

```bash
cp .env.example .env
```

Edit `.env` and replace all `CHANGEME` values with your actual secrets (API keys, passwords, etc.).

## Step 3: Start All Services

```bash
docker compose up --build
```

This builds and starts all 9 containers. First run takes a few minutes to pull images.

## Step 4: Access the Dashboard

Open your browser and navigate to:

- **Triage App**: [http://localhost:3001](http://localhost:3001)
- **Langfuse Dashboard**: [http://localhost:3000](http://localhost:3000)

## Step 5: Submit an Incident

Navigate to the triage dashboard and submit your first incident. The AI agent will analyze it and provide a triage recommendation.

## Step 6: Observe Traces in Langfuse

Open the Langfuse observability dashboard to view agent traces, latency metrics, and token usage.

---

## Troubleshooting

### Common Issues

**Port conflicts**: If port 3001 is already in use, change `CADDY_PORT` in `.env`.

**Docker build fails**: Ensure Docker Desktop is running and you have at least 4GB RAM allocated.

**Services not starting**: Run `docker compose logs` to check for errors. Ensure all `CHANGEME` values in `.env` have been replaced.

**Database connection errors**: Wait 10-15 seconds after startup for all services to initialize.
