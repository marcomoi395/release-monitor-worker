# release-monitor-worker

Cloudflare Worker that watches GitHub releases from configured repositories, uses OpenAI to summarize release notes in Vietnamese, then sends notifications to a Discord webhook.

## How it works

- Runs on an hourly cron (`0 * * * *`) or manually through `GET /run` when Worker is running.
- Reads `REPOSITORIES` from environment variables as a JSON array.
- Fetches `releases.atom` from each GitHub repository.
- Stores latest release in KV to avoid duplicate notifications.
- When a new release appears, calls OpenAI Responses API to generate a short summary.
- Sends formatted message to Discord webhook.

## Requirements

- Node.js
- npm
- Cloudflare account
- Wrangler CLI
- KV namespace bound to Worker
- OpenAI API key
- Discord webhook URL

## Install

```bash
npm install
```

## Environment setup

Create local file from template:

```bash
cp .env.example .dev.vars
```

Variables used by project:

- `REPOSITORIES`: JSON array of GitHub repository URLs.
  - Example: `["https://github.com/cloudflare/workers-sdk"]`
- `OPENAI_MODEL`: model used to summarize release notes.
- `OPENAI_API_KEY`: OpenAI secret.
- `DISCORD_WEBHOOK_URL`: webhook secret for notifications.

Set Worker secrets:

```bash
wrangler secret put OPENAI_API_KEY
wrangler secret put DISCORD_WEBHOOK_URL
```

Update `wrangler.jsonc` to use your own KV namespace if needed.

## Run locally

```bash
npm run dev
```

This script runs `wrangler dev --test-scheduled` to test scheduled flow locally.

## Quick checks

Run self-check:

```bash
npm run selfcheck
```

Run type check:

```bash
npm run typecheck
```

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Run Worker locally with scheduled testing |
| `npm run selfcheck` | Run assert-based self-check for parser, formatter, and `/run` handler |
| `npm run typecheck` | Run TypeScript type check without emit |
| `npm run deploy` | Deploy Worker with Wrangler |

## HTTP endpoints

- `GET /run`: runs monitor immediately, returns `monitor run complete`.
- Any other path: returns `release-monitor-worker ready`.

## Folder structure

```text
src/
  index.ts            Main Worker
  index.selfcheck.ts  Minimal self-check
```

## Notes

- First run only stores release baseline in KV and does not send notification.
- If `REPOSITORIES` is empty, Worker only logs `No repositories configured`.
- Discord summary is limited to 2000 characters.
