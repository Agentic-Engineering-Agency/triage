# INTEGRATION TEST STATUS — Manual Sync Note

> This file is still referenced by `PROJECT_STATE.md`, but its original "19 pending `it.todo(...)` tests" status is stale.
> As of 2026-04-08, the 19 infrastructure scenarios have been implemented as executable tests across the infra test suite.

## Status

- 19/19 infrastructure scenarios implemented
- 4 infra test files updated
- no executable `it.todo(...)` cases remain in `tests/infra-docker/`
- live-stack smoke validation with `docker compose up --build` is still recommended before a final hackathon demo

## Implemented Coverage

### architecture-alignment.test.ts

- 13 tests covering network segmentation, hostname resolution, Caddy proxy behavior, dev/prod mode assumptions, config routing, and Langfuse-related service expectations

### docker-compose.test.ts

- 3 tests covering compose smoke/config validation and missing `.env` failure behavior

### dockerfiles.test.ts

- 1 test covering the total image-size constraint

### env-config.test.ts

- 3 tests covering integration env vars, demo-mode behavior without Linear, and missing OpenRouter handling

## What Still Needs Manual Verification

These items are no longer "missing tests," but they are still worth exercising against a running stack before submission:

1. `docker compose up --build` from a clean clone
2. stub frontend at `http://localhost:3001`
3. runtime health endpoint at `http://localhost:3001/api/health`
4. `config.json` served correctly through Caddy
5. Langfuse dashboard availability at `http://localhost:3000`

## Notes

- The compose stack currently falls back to stub frontend/runtime containers when the real app code is not present.
- Live Docker/Helm smoke assertions are opt-in via `RUN_MANUAL_INFRA_TESTS=1 npm test`.
- This file was updated manually to keep the written documentation aligned with the implemented tests. `PROJECT_STATE.md` still needs a formal SpecSafe workflow update.
