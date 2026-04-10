# Triage Workflow Verification Guide

## Overview

This document outlines the complete verification flow for the triage incident workflow. After an incident is reported via the API, it goes through an 8-step workflow that ends with webhook-based verification when the assignee resolves the issue in Linear.

---

## Architecture Summary

### Current State ✅

**Infrastructure:**
- ✅ Wiki generation: Automatic cloning + chunking of public repos into persistent volume
- ✅ Code review agent: Exists but optional (only runs if PR link is present in issue description)
- ✅ Docker containers: All healthy except langfuse-worker (non-critical)
- ✅ Cloudflare tunnel: Exposes runtime to public HTTPS endpoints for webhooks

**Routes exposed via Cloudflare Tunnel:**
```
triage.agenticengineering.lat    → http://runtime:4111
slack.agenticengineering.lat     → http://runtime:4111
langfuse.agenticengineering.lat  → http://langfuse-web:3000
```

**Workflow Steps (8-step architecture):**
1. **Intake** – Validate incident report, enrich description
2. **Triage** – LLM analysis with wiki RAG fallback, classify severity + root cause
3. **Dedup** – Search existing issues, detect duplicates (0.85 similarity threshold)
4. **Ticket** – Create/update Linear issue with structured data
5. **Notify** – Send email + Slack to assignee about new ticket
6. **Suspend** – Workflow pauses, waiting for Linear webhook
7. **Verify** – When webhook arrives: read comments, optionally run code review
8. **Notify-Resolution** – Send final email + Slack with verdict + activity summary

---

## Verification Checklist (For Ricardo)

### Phase 1: Incident Submission (No PR, Comment-Only Path)

**Test Scenario:** Submit simple incident without PR link

**Expected Behavior:**

1. **Immediate Response (5-10s)**
   - ✅ POST /workflows/triage-workflow/trigger returns successfully
   - ✅ Issue created in Linear with triage info
   - ✅ Issue gets assigned to a team member

2. **Email to Assignee (10-20s)**
   - ✅ Resend email arrives at assignee's email
   - ✅ Email contains:
     - Incident title
     - Severity (P0-P4)
     - Root cause identified by AI
     - Linear issue link
     - **Instructions:** "Please add comments in Linear when resolved, then move issue to 'Done'"

3. **Slack Notification (10-20s)**
   - ✅ Slack message in configured channel
   - ✅ Contains severity emoji (🔴 for P0, 🟠 for P1, etc.)
   - ✅ Link to Linear issue
   - ✅ Assigned person name

### Phase 2: Assignee Resolves (Comment + Status Change)

**Test Steps:**

1. Open Linear issue
2. **Leave comment** with what was fixed:
   ```
   Fixed the null pointer in checkout by adding validation.
   Also optimized the database query.
   ```
3. **Move issue to "Done"** status in Linear

**What triggers webhook:**
- Linear webhook fired (configured at project creation)
- Runtime receives webhook at `https://triage.agenticengineering.lat/api/webhooks/linear`
- Workflow resumes at step 7 (Verify)

### Phase 3: Verification (Verify Step) ⚠️ THIS IS WHAT CHANGES

**Current Implementation:**
- Reads all comments from Linear issue
- Builds activity summary: `"[assignee-name] Fixed the null pointer..."`
- **No PR link case** → Uses resolution-reviewer agent with comment context
- Returns verdict: `'resolved'` (always)
- **PR link case** → Runs code-review-agent in parallel, may post GitHub comment

**Expected Output to Reporter:**

Email to reporter (original incident submitter):
```
Issue: [Issue Title]
Verdict: ✅ RESOLVED

Verification Notes:
The issue was addressed. Assignee reported the fix.

Activity Report:
[assignee-name] Fixed the null pointer in checkout by adding validation.
Also optimized the database query.

---
View issue: https://linear.com/...
```

Slack notification (same channel):
```
✅ Issue Resolved: [Issue Title]

Verdict: Resolved

Resolution: The issue was addressed. Assignee reported the fix.

Activity Report:
[assignee-name] Fixed the null pointer...
```

---

## What to Watch For (Gotchas)

### ✅ Working Paths
1. **Comment-only (No PR):** Comments → Email/Slack → Done
2. **With PR + no issues:** Diff reviewed → Comments on GitHub → Email/Slack → Done
3. **With PR + issues found:** Diff reviewed → GitHub comments + Linear moved to IN_REVIEW → Email/Slack says "needs review"

### ⚠️ Failure Points
- **Issue:** Linear webhook never fires
  - **Check:** Linear integration token saved? Webhook registered? Tunnel accessible?
  - **Verify:** Check docker logs: `docker-compose logs runtime | grep webhook`

- **Issue:** Email never arrives
  - **Check:** Resend token valid? Reporter email correct?
  - **Verify:** Check if email address is on .env `RESEND_FROM_EMAIL`

- **Issue:** Slack message never arrives
  - **Check:** Bot token valid? Channel ID saved to project?
  - **Verify:** `GET /projects/:id/settings/integrations` returns `slack.configured: true`

- **Issue:** Comments not showing in activity summary
  - **Check:** Issue was updated with status before webhook fired?
  - **Verify:** Check logs: `docker-compose logs runtime | grep "read comments"`

---

## Test Case: Full E2E Flow

**Setup (1 time):**
```bash
# 1. Create project with public repo
POST /projects
{
  "name": "Test Project",
  "repositoryUrl": "https://github.com/user/public-repo",
  "branch": "main"
}
# → Wiki generation starts in background

# 2. Configure Linear integration
POST /projects/:projectId/settings/linear/test
{ "token": "lin_api_..." }

# 3. Configure assignee & reporter
# (Assume Linear team already set up)
```

**Test (repeatable):**
```bash
# Step 1: Submit incident
POST /workflows/triage-workflow/trigger
{
  "reporterName": "Ricardo",
  "reporterEmail": "ricardo@example.com",
  "title": "Checkout page crashes on mobile",
  "description": "Users report 500 error when submitting payment on mobile",
  "repository": "myorg/myrepo"
}
# ← Expect: Issue ID returned in ~5s

# Step 2: Check Linear
# - Issue should exist
# - Should be assigned
# - Email should arrive at assignee

# Step 3: Assignee action (in Linear UI)
# - Add comment: "Fixed mobile checkout validation"
# - Move to "Done"

# Step 4: Check final notifications
# - Email should arrive at ricardo@example.com
# - Should say "✅ RESOLVED"
# - Should include assignee's comment
# - Slack notification should also appear
```

**Expected timing:**
- Incident creation to Linear issue: 5-10s
- Email/Slack to assignee: 10-20s
- Assignee resolves in Linear: instant (manual)
- Webhook fires: depends on Linear (~1-5s after status change)
- Final email/Slack to reporter: 5-10s after webhook fires
- **Total end-to-end (not including manual): ~30-50 seconds**

---

## Decisions Made

### ✅ Simplified Verification (Your Preference)
- **Current:** Reads comments, uses resolution-reviewer agent
- **Not doing:** Full code diff review + scope comparison (too complex for now)
- **Code review agent:** Still exists but only runs if PR link present in issue

### ✅ Wiki Strategy
- **Purpose:** Triage step only (step 2) — provides context for AI to classify severity
- **Not needed for:** Verification step (step 7) — just reads comments
- **Auto-generation:** Happens in background when project created

### ✅ Slack Channel Selection UI
- **Currently:** Uses hardcoded SLACK_CHANNEL_ID from .env
- **Capability:** Yes, API exists (`conversations.list()`) — could show dropdown
- **Timeline:** Not blocking — MVP uses hardcoded channel, UI selection is optional enhancement

---

## Next Steps (If Issues Found)

1. **Webhook not firing?**
   - Verify Linear webhook registered in dashboard
   - Check tunnel is accessible: `curl https://triage.agenticengineering.lat/api/webhooks/linear`
   - Logs: `docker-compose logs runtime | grep webhook`

2. **Comments not reading?**
   - Verify Linear API token has `issue:read` scope
   - Logs: `docker-compose logs runtime | grep "read comments"`

3. **Email not arriving?**
   - Verify reporter email is correct
   - Check Resend dashboard for failures
   - Verify .env RESEND_API_KEY is valid

4. **Performance issues?**
   - Wiki generation on large repos (>100MB) may slow triage step
   - Monitor: `GET /projects/:id` returns `status: 'pending'` during generation

---

## Files Changed

- `cloudflare-tunnel.yml`: Added routes for triage + slack webhooks
  ```yaml
  - hostname: triage.agenticengineering.lat → http://runtime:4111
  - hostname: slack.agenticengineering.lat → http://runtime:4111
  ```

---

**Ready to verify? Start with Phase 1 test case above.** 🚀
