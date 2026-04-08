# Quick Guide — Get Triage Running in 5 Minutes

> This branch is the hackathon foundation layer. `docker compose up --build` starts the full infrastructure plus stub frontend/runtime containers when the real app code is not present yet.

## Step 1: Clone the Repository

```bash
git clone https://github.com/Agentic-Engineering-Agency/triage.git
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

## Step 3: Run the Verification Suite

```bash
npm test
```

This runs the committed runtime and infrastructure test suites before you boot the stack.

To include the opt-in live Docker/Helm smoke checks, run:

```bash
RUN_MANUAL_INFRA_TESTS=1 npm test
```

## Step 4: Start All Services

```bash
docker compose up --build
```

This builds and starts all 9 containers. First run takes a few minutes to pull images.

## Step 5: Access the Stack

Open your browser and navigate to:

- **Frontend container**: [http://localhost:3001](http://localhost:3001)
- **Langfuse Dashboard**: [http://localhost:3000](http://localhost:3000)

On the current branch, `http://localhost:3001` is expected to show the infrastructure stub page unless a real `frontend/` application has been added.

## Step 6: Verify the Runtime Stub and Observability

- `http://localhost:3001/api/health` should return a healthy JSON response from the stub runtime
- `http://localhost:3001/config.json` should return the mounted runtime config file
- `http://localhost:3000` should load the Langfuse dashboard

## Step 7: Inspect the Implemented Hackathon Foundation

- Linear tools: `runtime/src/mastra/tools/linear.ts`
- Resend tools: `runtime/src/mastra/tools/resend.ts`
- Shared schemas: `runtime/src/lib/schemas/ticket.ts`
- Infra tests: `tests/infra-docker/*.test.ts`

The full chat UI and workflow runtime are planned but not fully committed on this branch yet.

---

## Troubleshooting

### Common Issues

**Port conflicts**: If port 3001 is already in use, change `CADDY_PORT` in `.env`.

**Docker build fails**: Ensure Docker Desktop is running and you have at least 4GB RAM allocated.

**Services not starting**: Run `docker compose logs` to check for errors. Ensure all `CHANGEME` values in `.env` have been replaced.

**Database connection errors**: Wait 10-15 seconds after startup for all services to initialize.

**Dev mode does not work**: `docker-compose.override.yml` expects a real `frontend/` app and a real runtime entrypoint. On this branch, development mode is intentionally incomplete because Docker falls back to the stubs.

**Why am I seeing a stub page?**: That is expected until the frontend SPA and runtime entrypoint are added. The compose stack is still useful for validating networking, health checks, config serving, and Langfuse.
