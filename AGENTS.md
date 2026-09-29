# Project context for AI coding agents

## Goal
Build and maintain an event-driven GitHub automation product. Preserve the assignment's end-to-end focus: GitHub App authentication, repository installation, signed webhooks, durable event processing, GitHub write-back, Slack notification, dashboard rules, retries, and observability.

## Non-negotiable rules
- Never hard-code or commit secrets.
- Never log GitHub private keys, OAuth client secrets, access tokens, Slack tokens, database URLs, or Gemini keys.
- Keep webhook HMAC verification before parsing the JSON body.
- Keep `X-GitHub-Delivery` deduplication.
- Do not perform slow GitHub/Slack/AI calls synchronously inside the webhook HTTP request.
- GitHub repository actions must use installation access tokens generated from a short-lived GitHub App JWT.
- Every new external side effect should be represented in the `actions` table where practical.
- Preserve retry/error visibility in the dashboard.
- Validate ownership before modifying repositories or rules.

## Stack
- Backend: Node.js + TypeScript + Express + PostgreSQL
- Frontend: React + Vite + TypeScript
- Deployment: Docker/Render
- Notifications: Slack Web API
- Optional AI: Gemini `generateContent`

## Before changing the integration
Check the current official GitHub API documentation because GitHub API permissions and authentication behavior can evolve.
