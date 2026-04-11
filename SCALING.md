# SCALING — From Docker Compose to Production

> The full application is deployed with all features operational: chat-based triage, Wiki/RAG codebase indexing, Linear ticketing, email + Slack notifications, and the complete Langfuse observability stack.

## Single-Host Capacity (Docker Compose)

Before K8s is needed, the Docker Compose stack handles the following load on a single host (estimated from LibSQL write throughput and LLM API latency):

| Metric | Estimate | Bottleneck |
|--------|----------|------------|
| Concurrent users | ~50 | Runtime HTTP thread pool |
| Incidents per day | ~200 | LibSQL single-writer + LLM round-trip |
| Triage latency (p50) | ~8–12s | OpenRouter API call chain |
| Triage latency (p95) | ~25s | LLM queue depth at peak |
| Wiki RAG queries/day | ~1,000 | LibSQL DiskANN vector search |

**When to migrate to K8s:** sustained >40 concurrent users, >150 incidents/day, or when you need zero-downtime deploys and multi-replica HA. Below that threshold, the Docker Compose stack is operationally simpler and sufficient.

## Current Architecture: Docker Compose

All 10 services run as containers orchestrated by Docker Compose.

```mermaid
graph TD
    subgraph DockerCompose["Docker Compose Stack"]
        frontend["frontend :3001"]
        runtime["runtime :4111"]
        libsql["libsql :8080"]
        langfuse-web["langfuse-web :3000"]
        langfuse-worker["langfuse-worker :3030"]
        clickhouse["clickhouse :8123"]
        redis["redis :6379"]
        minio["minio :9000"]
        langfuse-postgres["langfuse-postgres :5432"]
        cloudflared["cloudflared (Tunnel)"]
    end
    frontend --> runtime
    runtime --> libsql
    openrouter["OpenRouter (LLM gateway + Broadcast)"]
    runtime -->|chat + embeddings| openrouter
    openrouter -->|workspace Broadcast| langfuse-web
    langfuse-web --> langfuse-worker
    langfuse-worker --> clickhouse
    langfuse-worker --> redis
    langfuse-worker --> minio
    langfuse-web --> langfuse-postgres
    cloudflared -->|outbound tunnel| langfuse-web
```

## Kubernetes / K8s Migration Path

For production, we migrate to Kubernetes with Helm charts.

```mermaid
graph TD
    subgraph Edge["Edge / CDN Layer"]
        cf["Cloudflare Pages (static assets)"]
        tunnel["Cloudflare Tunnel (webhook ingress)"]
    end
    subgraph K8sCluster["Kubernetes Cluster"]
        subgraph AppNS["app namespace"]
            fe["frontend Deployment (internal proxy)"]
            rt["runtime Deployment"]
            db["libsql StatefulSet"]
        end
        subgraph ObsNS["observability namespace"]
            lfw["langfuse-web Deployment"]
            lwork["langfuse-worker Deployment"]
            ch["clickhouse StatefulSet"]
            rd["redis StatefulSet"]
            mn["minio StatefulSet"]
            pg["langfuse-postgres StatefulSet"]
        end
        Ingress["nginx Ingress (TLS termination)"]
    end
    cf -->|"/api/* proxied"| Ingress
    tunnel -->|"/api/webhooks/linear"| Ingress
    Ingress --> fe
    Ingress --> rt
    fe --> rt
    rt --> db
    rt --> lfw
```

## Webhook Ingress at Scale

Linear webhooks require a stable, publicly reachable HTTPS endpoint. In production:

1. **Cloudflare Tunnel (recommended for early prod)** — run `cloudflared` as a K8s Deployment. Creates an outbound-only tunnel from the cluster to Cloudflare's edge. No static IP needed, no firewall holes, free tier available. Maps `https://triage.example.com/api/webhooks/linear` → `runtime:4111/api/webhooks/linear`.

2. **nginx Ingress + static IP (K8s standard)** — assign a LoadBalancer service with a static external IP. Ingress terminates TLS via cert-manager (Let's Encrypt). Route `/api/webhooks/*` directly to the runtime Service. This is the default path in `k8s/helm/values.yaml` (`ingress.className: nginx`).

3. **ngrok / Cloudflare Tunnel in dev** — for local development and hackathon demos, run `cloudflared tunnel --url http://localhost:4111` or `ngrok http 4111` and register the resulting URL in Linear's webhook settings.

> The runtime webhook handler at `POST /api/webhooks/linear` verifies the `linear-signature` header (HMAC-SHA256) before processing. This signature check is the primary security control for the public-facing webhook endpoint.

## CDN and Static Asset Delivery

At scale, the Caddy static file server becomes a bottleneck for frontend asset delivery. The production topology moves static assets to the edge:

- **Cloudflare Pages** serves the compiled Vite SPA (`dist/`) via Cloudflare's global CDN. Build artifacts are deployed automatically on merge to `main`.
- **Caddy / nginx Ingress** becomes an internal proxy only, forwarding `/api/*` and `/auth/*` to the runtime. It no longer serves HTML/JS/CSS.
- **Cache headers:** Immutable assets (`/assets/*.js`, `/assets/*.css`) get `Cache-Control: public, max-age=31536000, immutable`. `index.html` gets `Cache-Control: no-cache` to ensure SPA routing picks up new deploys.

This eliminates the frontend container as a scaling concern — CDN handles all static traffic regardless of incident volume.

## Per-Service Scaling Table

| Service | Scaling Strategy | Replicas (Dev) | Replicas (Prod) | Notes |
|---------|-----------------|----------------|-----------------|-------|
| frontend | Horizontal scaling | 1 | 2-4 | Stateless; CDN offloads static at scale |
| runtime | Horizontal scaling | 1 | 3-6 | Stateless, CPU-bound |
| libsql | Vertical scaling | 1 | 1 | Single-writer |
| langfuse-web | Horizontal scaling | 1 | 2-3 | Stateless |
| langfuse-worker | Horizontal scaling | 1 | 3-5 | Queue consumers |
| clickhouse | Vertical scaling | 1 | 1-3 | Sharding for scale |
| redis | Vertical scaling | 1 | 1 | Sentinel for HA |
| minio | Horizontal scaling | 1 | 4+ | Erasure coding |
| langfuse-postgres | Vertical scaling | 1 | 1 | Read replicas |

## HPA Autoscaling Specs (autoscaling/v2)

HPA is enabled for `frontend` and `runtime` in `k8s/helm/values.yaml`. The target CPU utilization is **50%** — chosen to leave headroom for LLM response bursts without triggering scale-down oscillation.

```yaml
# frontend HPA
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
spec:
  minReplicas: 1        # values.yaml: frontend.autoscaling.minReplicas
  maxReplicas: 5        # values.yaml: frontend.autoscaling.maxReplicas
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 50
  # Resource envelope per pod: request 500m CPU / 512Mi RAM, limit 2 CPU / 2Gi RAM
```

```yaml
# runtime HPA
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
spec:
  minReplicas: 1        # values.yaml: runtime.autoscaling.minReplicas
  maxReplicas: 5        # values.yaml: runtime.autoscaling.maxReplicas
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 50
  # Resource envelope per pod: request 1 CPU / 1Gi RAM, limit 2 CPU / 4Gi RAM
```

`langfuse-web` and `langfuse-worker` do not have HPA configured in the current Helm chart; they are scaled manually via `replicaCount` overrides. Add HPA for `langfuse-worker` when trace ingest volume exceeds Redis queue depth SLOs.

## Bottleneck Analysis

Key bottlenecks identified:

1. **Runtime ↔ LLM latency** — OpenRouter API calls are the primary bottleneck. Mitigate with request batching and caching.
2. **LibSQL write throughput** — Single-writer architecture limits write scaling. Consider sharding or migration to distributed SQL.
3. **ClickHouse ingestion** — High trace volume can saturate ingestion. Buffer via Redis queues.
4. **Network egress** — LLM API calls generate significant outbound traffic.
5. **Wiki/RAG embedding throughput** — Large codebases (>10k files) generate significant embedding API calls during initial ingestion. Batching (20 chunks/request) and deduplication hashes mitigate cost, but ingestion of very large repos is I/O bound on clone + scan.
6. **Slack API rate limits** — Slack's `chat.postMessage` allows ~1 message/second per channel. At high incident volume (>50/minute), notifications should be batched or routed to multiple channels. Current implementation is sufficient for <200 incidents/day.

## Cost Projection

| Scale Tier | Incidents/day | Infra Cost/mo | LLM Cost/mo | Email Cost/mo | Slack Cost/mo | Total/mo |
|-----------|---------------|---------------|-------------|---------------|---------------|----------|
| Dev | <10 | $0 (local) | ~$5 | $0 (Resend free) | $0 (free) | ~$5 |
| Seed | ~10 | ~$150 | ~$55 | $0 (Resend free) | $0 (free) | ~$205 |
| Growth | ~50 | ~$500 | ~$275 | ~$10 | $0 (free) | ~$785 |
| Scale | ~200 | ~$1,800 | ~$1,100 | ~$40 | $0 (free) | ~$2,940 |
| Enterprise | 1,000+ | ~$3,000 | ~$5,500 | ~$200 | $0 (free) | ~$8,700 |

> **Cost assumptions:**
> - Average tokens per triage: ~2,000 input + ~1,000 output = ~3,000 tokens total
> - Model mix: Mercury-2 (~$0.60/1M tokens) for fast triage classification; MiniMax M2.7 (~$2/1M tokens) for root-cause reasoning and resolution review. Blended effective rate used in projections: ~$0.92/1M tokens
> - LLM cost formula: `incidents/day × 30 days × 3,000 tokens × blended_rate`
> - Email: Resend free tier covers 100 emails/day (3,000/mo). Paid plan at $20/mo covers 50,000/mo — sufficient through Growth tier
> - Slack: Free tier includes unlimited messages via Bot API. No per-message cost. Rate limit is ~1 msg/sec/channel — sufficient for all tiers listed
> - Infra: Docker Compose on a single VPS at Seed; managed K8s (EKS/GKE) from Growth onward
> - These are estimates; actual costs vary with model selection, retry rates, and image attachment token overhead

## Summary: Scaling Triggers

| Trigger | Action |
|---------|--------|
| >40 concurrent users | Migrate to K8s |
| >150 incidents/day | Migrate to K8s + add libsql read replicas |
| >200 incidents/day | Enable CDN (Cloudflare Pages), tune HPA |
| >500 incidents/day | Evaluate libsql → distributed SQL (PlanetScale / Turso multi-tenant) |
| Linear webhook reliability issues | Switch to Cloudflare Tunnel from static IP ingress |
