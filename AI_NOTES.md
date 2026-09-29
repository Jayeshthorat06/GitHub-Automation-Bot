# AI_NOTES

> This file is intentionally a template for the candidate to finalize before submission. Replace the bracketed text with the truth about how you used AI during the assignment.

## AI tools/models used
- [Fill in: e.g. ChatGPT GPT-5.6 Luna]
- [Fill in any IDE agent/model used]

## How AI and I split the work
I used AI for [fill in]. I personally handled [architecture, service selection, GitHub App configuration, deployment, debugging, testing].

## Key decisions I made
1. **GitHub App instead of plain OAuth App:** [Explain that the assignment's stretch goal explicitly asks for GitHub App JWT + installation tokens, and that this also gives fine-grained repository permissions and webhooks.]
2. **Durable Postgres event inbox:** [Explain why webhook receipt is separated from downstream GitHub/Slack/AI work and why this helps with retries and duplicate deliveries.]
3. **Single Render service + Neon Postgres:** [Explain the free-tier/no-card constraint and why this architecture was selected.]

## Hardest bug / wrong turn
[Describe one real bug you encountered. Example: webhook signature verification failed because Express parsed JSON before the raw bytes were available. Explain how you identified it and fixed the route ordering/raw-body handling. Do not invent a story if you did not encounter it.]

## What I would improve
[Examples: durable queue such as a managed queue, richer rule builder, per-repository Slack channels, encrypted token rotation, better action-level idempotency, structured log aggregation, automated integration tests.]
