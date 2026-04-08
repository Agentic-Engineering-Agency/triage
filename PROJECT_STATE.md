# PROJECT_STATE

> Single source of truth for all spec status. Updated automatically by SpecSafe.

## Active Specs

| ID | Name | Stage | Created | Description |
|----|------|-------|---------|-------------|
| SPEC-20260407-001 | infra-docker-k8s-init | CODE | 2026-04-07 | Infrastructure: Docker Compose (9 containers), K8s scaffolding, documentation templates |
| SPEC-20260408-001 | docker-compose-architecture-alignment | CODE | 2026-04-08 | Docker Compose update: two networks, dev/prod mode, Caddyfile env switching, config.json |

## ⚠️ Pending Integration Tests (19 tests)

**File:** [specs/active/PENDING-INTEGRATION-TESTS.md](specs/active/PENDING-INTEGRATION-TESTS.md)

19 `it.todo(...)` tests require a running Docker stack to implement.
They cover: full stack smoke tests, network isolation, dev/prod mode
switching, config.json serving, graceful degradation, and image size.
**Do not ship without completing these once `docker compose up` works.**

## Completed Specs

_No completed specs._

## Archived Specs

_No archived specs._
