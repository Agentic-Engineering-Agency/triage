# Risk Matrix — SRE Incident Triage Agent

## Risk Assessment (Post-Team Review)

| # | Risk | Impact | Likelihood | Team Verdict | Mitigation |
|---|------|--------|------------|-------------|------------|
| 1 | OpenRouter free tier down/rate-limited | Critical | **Very Low** | Not a real risk. OpenRouter has internal fallbacks (free router). Can pay a few dollars if needed. Mercury, Groq, Gemini as alternatives. | Configure `@openrouter/ai-sdk-provider` with fallback. One env var change to switch models. |
| 2 | Langfuse stack OOM or fails to start | High | **Very Low** | Not happening. Containers include ClickHouse+Redis+MinIO — all lightweight. If it fails on one machine, run on another. | Memory limits in compose. Start first. Pre-capture evidence screenshots as backup. |
| 3 | LibSQL ARM64 compatibility | High | **Very Low** | Works fine. Has `latest-arm` tag. | Pin correct platform tag in compose. |
| 4 | Linear webhook unreachable locally | High | **Very Low** | Not a risk for pre-recorded demo. If needed for live, use Cloudflare Tunnel. | Mock trigger button in UI as backup. |
| 5 | Solidus wiki generation too slow | High | **Very Low** | Pre-generate before recording demo. | Cache results, scope to `solidus_core` if needed. |
| 6 | Better Auth + Drizzle + LibSQL edge cases | Medium | **Medium** | **Real risk.** Implement early Day 1 morning. | If breaks, hardcode user for demo. Auth not a judging criterion. |
| 7 | Mastra workflow state loss on restart | Medium | **Low** | State persists to LibSQL. Add error handling. Inngest as fallback if needed. | Test suspend → restart → resume cycle. |
| 8 | Multimodal not working with current free model | Critical | **Very Low** | OpenRouter multimodal works. Validated. | Test Day 1 first thing with specific model. |
| 9 | Docker build fails on clean machine | Medium | **Low** | Will test. Can run on multiple machines (Mac, Linux, server). | Test from scratch before demo. |
| 10 | Demo video exceeds 3 minutes | Medium | **Medium** | **Real risk.** Must script carefully with allocated seconds. Can speed up video. | Script with timestamps, practice twice, record multiple takes. |

## Critical Day 1 Validations

These must pass in the first 2 hours:
1. `docker compose up --build` — all containers healthy
2. Mastra ↔ LibSQL connection working
3. OpenRouter multimodal response (text + image)
4. Langfuse receiving traces
5. Better Auth login flow
6. Linear API ticket creation
