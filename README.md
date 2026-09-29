# Event-Driven GitHub Automation Bot

A full-stack GitHub App that signs users in with GitHub, lets them install/connect repositories, receives GitHub webhooks, evaluates configurable rules, writes back to GitHub, optionally runs AI triage, and sends Slack notifications.

This implementation maps directly to the supplied assignment: GitHub sign-in + repository connection, webhook events, GitHub write-back, Slack notification, authenticated dashboard, configurable rules, public deployment guidance, and reliability/security controls. The assignment explicitly calls out duplicate delivery handling, forged/replayed request protection, retry behavior, secret protection, and an optional GitHub App/JWT, multi-repository, observability, and AI layer. See the supplied brief for the grading criteria.

## Architecture

```text
Browser / React
      |
      | GitHub App user authorization
      v
Express API + worker --------------------> Neon Postgres
      |
      | GitHub App JWT -> installation token
      v
GitHub REST API <------------------------- GitHub Webhooks
      |
      +-------------------------------> Slack API
      |
      +-------------------------------> Gemini API (optional)
```

The backend uses an inbox-style `events` table. The webhook endpoint verifies the GitHub HMAC signature, deduplicates by `X-GitHub-Delivery`, stores the event, and immediately returns `202`. A background worker claims pending events and retries failed processing up to five attempts. This avoids doing slow downstream work inside the webhook request.

## Local setup

### 1. Requirements

- Node.js 22+
- A Postgres database (Neon is a good free-tier option)
- A GitHub account
- A Slack workspace where you can install a Slack app
- Optional: a Google AI Studio Gemini API key for AI triage

### 2. Install

```bash
npm install
npm run install:all
```

### 3. Create a GitHub App

GitHub -> Settings -> Developer settings -> GitHub Apps -> New GitHub App.

Use:

- Homepage URL: `http://localhost:8080`
- Callback URL: `http://localhost:8080/auth/github/callback`
- Setup URL: `http://localhost:8080/auth/github/setup`
- Webhook URL: `http://localhost:8080/api/github/webhook` only works if GitHub can reach your machine; for local development use a secure public tunnel or Smee. Do not use Smee in production.
- Webhook active: enabled
- Subscribe to: `Issues`, `Pull request`, `Push`
- Repository permissions:
  - Contents: Read-only
  - Issues: Read and write
  - Pull requests: Read-only (write if you later add review APIs)
  - Metadata: Read-only
- Do NOT enable "Request user authorization (OAuth) during installation" because this implementation uses the separate login callback and installation setup callback.
- Generate a private key and a client secret.

Make the app public if evaluators need to install it from their own accounts.

### 4. Create `.env`

Copy `backend/.env.example` to `backend/.env` and fill in the values.

Generate `APP_ENCRYPTION_KEY` with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Generate a webhook secret and session secret with a password generator or a random-byte command. Never commit either.

### 5. Start

```bash
npm run dev
```

Frontend: `http://localhost:5173`
Backend: `http://localhost:8080`

The Vite proxy forwards `/api` and `/auth` to the backend.

### 6. Local webhook testing

GitHub webhooks require a publicly reachable endpoint. For development, use a tunnel such as Cloudflare Tunnel or a webhook proxy such as Smee. GitHub's own quickstart documents Smee for local testing and explicitly says not to use it for production.

Set the GitHub App webhook URL to your public tunnel URL + `/api/github/webhook`.

## Production deployment

The included `Dockerfile` builds React and TypeScript and runs the Express service as one web service. The included `render.yaml` is prepared for Render.

1. Create a free Neon Postgres database and copy its connection string.
2. Push this repository to GitHub.
3. Create a Render Web Service from the repository using the Dockerfile.
4. Set the environment variables from `backend/.env.example`.
5. After Render gives you a URL such as `https://your-app.onrender.com`, set:
   - `APP_BASE_URL=https://your-app.onrender.com`
   - `FRONTEND_URL=https://your-app.onrender.com`
6. Update the GitHub App:
   - Homepage URL = `https://your-app.onrender.com`
   - Callback URL = `https://your-app.onrender.com/auth/github/callback`
   - Setup URL = `https://your-app.onrender.com/auth/github/setup`
   - Webhook URL = `https://your-app.onrender.com/api/github/webhook`
7. Redeploy if necessary.

### Important free-tier caveat

A free web host can sleep or restart. The database-backed event inbox makes webhook handling durable across application restarts, but no in-memory queue is used. GitHub should also be configured with the webhook secret. If the service is temporarily unavailable, GitHub can redeliver webhook deliveries; the `X-GitHub-Delivery` unique constraint makes duplicate deliveries harmless.

## Slack setup

Create a Slack app in the Slack API dashboard, install it to your workspace, and give it permission to post messages (`chat:write`). Obtain the bot token and channel ID and set:

```text
SLACK_BOT_TOKEN=xoxb-...
SLACK_CHANNEL_ID=C...
```

The dashboard has a Slack test button.

## AI setup

The optional AI layer uses Gemini's `generateContent` REST API. Set:

```text
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-2.5-flash
```

Rules can enable/disable AI triage. The AI output is included in Slack notifications and stored in action details when the action succeeds.

## Rule example

Create:

- Event: `issues`
- Keyword: `bug`
- Action label: `bug`
- Comment: `Thanks {{author}}. This item was automatically triaged by the bot.`
- Slack: enabled
- AI: enabled

When an issue titled `Bug: login fails` is opened:

1. GitHub sends the webhook.
2. The backend validates the HMAC signature.
3. The event is stored with the GitHub delivery ID.
4. The worker finds the connected repository and matching rule.
5. Gemini summarizes/suggests priority and a label when configured.
6. The bot adds the `bug` label.
7. The bot posts the configured comment.
8. Slack receives a notification.
9. Dashboard shows the event and action statuses.

## Reliability/security decisions

- Webhook HMAC validation using `X-Hub-Signature-256`.
- Unique `X-GitHub-Delivery` prevents duplicate event processing.
- Database inbox decouples webhook receipt from downstream calls.
- Worker retry limit with visible `failed` state and error text.
- Installation tokens are short-lived and generated using a GitHub App JWT.
- GitHub private key, client secret, Slack token, database URL, and AI key are server-side environment variables only.
- Session cookies are HTTP-only and secure in production.
- Repository and rule APIs enforce ownership through the authenticated user's installation.
- Comment actions contain an event marker so a worker retry can avoid duplicating the same bot comment.

## Useful API endpoints

```text
GET  /auth/github
GET  /auth/github/callback
GET  /auth/github/setup
POST /api/github/webhook
GET  /api/me
GET  /api/repositories
POST /api/repositories/:id/connect
GET  /api/rules
POST /api/rules
DELETE /api/rules/:id
GET  /api/events
POST /api/slack/test
POST /api/logout
GET  /api/health
```

## GitHub App authentication model

This project intentionally uses a GitHub App rather than a plain OAuth App for the repository automation. GitHub user authorization is used for application login, while repository automation uses the GitHub App's RS256 JWT to mint an installation access token. The installation token is then used for GitHub REST API actions.

## Submission checklist

- [ ] Public deployed URL works
- [ ] GitHub App is reachable/installable
- [ ] GitHub callback URL matches production URL
- [ ] GitHub webhook URL is production URL
- [ ] At least Issues, Pull Request, and Push events enabled
- [ ] Slack app installed and channel ID configured
- [ ] Neon database configured
- [ ] `.env` not committed
- [ ] `backend/.env.example` contains no real secrets
- [ ] `AI_NOTES.md` completed with your actual AI usage and decisions
- [ ] `AGENTS.md` reviewed and kept with the repository
- [ ] Commit history is clean and meaningful
