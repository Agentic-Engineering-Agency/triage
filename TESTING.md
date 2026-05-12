# Complete Flow Testing Guide

## Architecture Update

The Linear configuration is now **dynamic and workspace-agnostic**. You can test with ANY Linear workspace, not just `agentic-engineering-agency`.

### What Changed

| Before | After |
|--------|-------|
| Hardcoded Linear team/state/label UUIDs | `LINEAR_TEAM_ID` from `.env` with fallback |
| System tied to one Linear org | Works with any Linear workspace |
| Can't test without modifying code | Set `LINEAR_TEAM_ID` and go |

### Configuration Flow

```
.env (LINEAR_TEAM_ID, LINEAR_API_KEY)
  ↓
config.ts (validated + exported as LINEAR_CONSTANTS.TEAM_ID)
  ↓
Workflow / Routes (use LINEAR_CONSTANTS.TEAM_ID)
  ↓
Dynamic resolvers (resolveStateId, resolveLabelId)
  ↓
Fallback to hardcoded UUIDs (if API fails or state not found)
```

## Testing Complete Flow

### 1. Prepare Your Linear Workspace

You have two options:

#### Option A: Use the existing TRI team (default)
No setup needed. The system defaults to `645a639b-39e2-4abe-8ded-3346d2f79f9f` (TRI team from agentic-engineering-agency).

#### Option B: Test with your own Linear workspace
1. Create a team in your Linear workspace
2. Copy the team UUID from the URL:
   - Go to: `https://linear.app/your-workspace/team/YOUR_TEAM_KEY/all`
   - The UUID is in the URL structure (appears in Linear's internal APIs)
3. Set `LINEAR_TEAM_ID` in `.env`:
   ```
   LINEAR_TEAM_ID=your-team-uuid-here
   ```

### 2. Setup .env

Copy `.env.example` and fill in values:

```bash
cp .env.example .env
```

Required variables:
```env
# LLM (required for workflows)
OPENROUTER_API_KEY=sk-or-...

# Linear integration (required for ticket creation)
LINEAR_API_KEY=lin_...
LINEAR_TEAM_ID=645a639b-39e2-4abe-8ded-3346d2f79f9f  # or your team's UUID

# Database
LIBSQL_URL=http://libsql:8080

# Optional but recommended
RESEND_API_KEY=re_...
SLACK_BOT_TOKEN=xoxb-...
SLACK_CHANNEL_ID=C...
```

### 3. Start Containers

```bash
docker-compose up -d
```

Wait for all services to be healthy:
- Frontend: http://localhost:3001
- Runtime API: http://localhost:4111
- Langfuse: http://langfuse.agenticengineering.lat

### 4. Complete Workflow Test (Happy Path)

#### Step 1: Submit an Incident Report
```bash
curl -X POST http://localhost:4111/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{
      "role": "user",
      "content": "There is a critical bug in the auth module where user sessions are timing out unexpectedly after 10 minutes of inactivity"
    }]
  }'
```

Or use the web UI: http://localhost:3001 → Chat tab

#### Step 2: Watch the Workflow Execute

Check the runtime logs:
```bash
docker logs -f triage-runtime
```

You should see:
1. `[intake]` - Receiving incident
2. `[triage]` - Analyzing with RAG (if wiki exists)
3. `[dedup]` - Checking for duplicates
4. `[ticket]` - Creating Linear ticket
5. `[notify]` - Sending notifications
6. `[suspend]` - Waiting for webhook

#### Step 3: Monitor Linear

A new ticket should appear in your Linear team:
- Title: Brief summary of the incident
- Description: Includes root cause, details, suggested files
- Labels: Severity (P0-P4) + BUG category
- State: TRIAGE (waiting for assignment)

#### Step 4: Assign & Work the Ticket

In Linear:
1. Click the ticket
2. Assign to yourself
3. Move to IN_PROGRESS
4. Add a comment: "Fixed in PR #123"
5. Create a PR link in the description
6. Move to DONE

#### Step 5: Webhook Resume & Verification

When you move the ticket to DONE:
1. Linear sends a webhook to `/api/webhooks/linear`
2. Workflow resumes at `[verify]` step
3. Agents review the PR and comments
4. Final notification sent to reporter

### 5. Partial Flow Tests

#### Test Just Ticket Creation (no workflow suspension)

POST to `/api/workflows/triage-workflow/trigger`:
```bash
curl -X POST http://localhost:4111/api/workflows/triage-workflow/trigger \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Test incident",
    "reporterEmail": "test@example.com",
    "repository": "your-org/repo"
  }'
```

Watch logs:
```
[intake] Receive and validate incident report
[triage] Analyse incident
[dedup] Check for duplicate/similar existing tickets in Linear
[ticket] Create Linear ticket
[notify] Send email + Slack notification to assignee about new ticket
[suspend] Suspend workflow – wait for webhook
```

#### Test States/Labels Resolution

Check if states and labels resolve correctly by looking at created tickets:
- Expected states: TRIAGE, BACKLOG, TODO, IN_PROGRESS, IN_REVIEW, DONE
- Expected labels: CRITICAL, HIGH, MEDIUM, LOW, BUG

If a state isn't found in your Linear workspace, the system:
1. Logs a warning
2. Falls back to hardcoded UUID
3. Continues (may fail if hardcoded UUID doesn't exist in your workspace)

### 6. Debugging

#### No ticket created?

Check:
1. `LINEAR_API_KEY` is valid
2. `LINEAR_TEAM_ID` exists in your Linear workspace
3. States/labels exist (search for them in Linear)
4. Runtime logs: `docker logs triage-runtime`

#### States/labels not resolving?

The system tries:
1. **Cache** (1-hour TTL)
2. **API** (dynamic fetch from Linear)
3. **Fallback** (hardcoded UUIDs)

If you changed Linear team setup, clear the cache by restarting the runtime:
```bash
docker restart triage-runtime
```

#### Webhook not firing?

1. Linear webhook setup: POST `/api/linear/webhook/setup`
2. Make sure your deployment URL is publicly accessible
3. Check Linear webhook logs: Linear app → Settings → Webhooks

### 7. What Happens Without LINEAR_API_KEY

The system gracefully degrades:
- ✅ Chat and incident intake work
- ✅ Triage analysis works (using fallback hardcoded states)
- ❌ Ticket creation fails (Linear API required)
- ❌ Webhook resume fails (Linear API required)

Set `LINEAR_API_KEY` to enable the full flow.

## Expected Behavior

### Happy Path Timeline

```
T+0s    User submits incident report
T+5s    Triage analysis completes (calls LLM + RAG)
T+10s   Dedup check completes
T+15s   Linear ticket created
T+20s   Email notification sent to assignee
T+25s   Slack notification sent (if configured)
T+25s   Workflow suspended (waiting for webhook)

[... user works the ticket ...]

T+1h    User moves ticket to DONE
T+1h    Linear sends webhook
T+1h+5s Workflow resumes at verify step
T+1h+10s Code review runs (if PR attached)
T+1h+15s Final notification sent to reporter
T+1h+20s Workflow completes
```

### State Transitions

```
TRIAGE
  ↓ (assign + work)
IN_PROGRESS
  ↓ (code review feedback)
IN_REVIEW (if issues found)
  ↓ (fix issues)
IN_PROGRESS
  ↓ (fix merged)
DONE
  ↓ (webhook fires)
[verify step runs]
```

## Troubleshooting Checklist

- [ ] `.env` file exists and has required variables
- [ ] `LINEAR_API_KEY` is valid (test with: `curl -H "Authorization: Bearer $LINEAR_API_KEY" https://api.linear.app/graphql`)
- [ ] `LINEAR_TEAM_ID` exists in your workspace (verify in Linear URL)
- [ ] States exist in Linear: TRIAGE, TODO, IN_PROGRESS, IN_REVIEW, DONE (search by name)
- [ ] Labels exist: CRITICAL, HIGH, MEDIUM, LOW, BUG (search by name)
- [ ] `OPENROUTER_API_KEY` is valid
- [ ] `LIBSQL_URL` points to running database
- [ ] Docker containers are running: `docker ps`
- [ ] Runtime is responding: `curl http://localhost:4111/api/config/status`

## Reset State

If you want to start fresh:

```bash
# Clear Linear tickets created during testing
# (manually delete in Linear, or use Linear API)

# Restart the runtime
docker restart triage-runtime

# Clear the database
docker exec triage-libsql sqlite3 /data/triage.db "DELETE FROM projects;"

# Clear the workflow storage
docker restart triage-runtime
```

## Next Steps

Once the complete flow works end-to-end:

1. **Per-project configuration**: Add project-specific Linear teams/credentials
2. **Wiki generation**: Trigger wiki RAG for your repository
3. **Slack integration**: Configure Slack notifications
4. **GitHub integration**: Enable PR commenting and webhook integration
