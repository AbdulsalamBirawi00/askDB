# AskDB

Ask questions about a PostgreSQL database in Arabic or English and get back a table, a chart, and a short summary. Generated SQL is always read-only, enforced by three independent safety layers.

> Work in progress. The full plan is in [PROJECT_PLAN.md](PROJECT_PLAN.md).

## Local setup

Requires Node 22+, pnpm, and Docker.

```bash
pnpm install
cp .env.example .env
pnpm db:up
pnpm db:migrate
pnpm dev
```

Open http://localhost:3000. Health check: http://localhost:3000/api/health.

## Tests

```bash
pnpm lint
pnpm typecheck
pnpm test        # unit + integration (needs the local DB)
pnpm test:e2e    # Playwright
```
