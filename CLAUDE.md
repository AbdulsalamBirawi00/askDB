# CLAUDE.md

`PROJECT_PLAN.md` is the single source of truth. Read it before writing code. Work one stage at a time, and do not start a stage until every test scenario of the previous one passes. Tick the checklist at the bottom of the plan when a stage is done.

## Rules

- **Git writes only when the user asks** in the current request (add, commit, push, merge). Read-only git is always fine.
- **100% free:** never add a paid service or one that needs a credit card.
- **Read-only against user databases.** All SQL from the model or a user goes through `packages/core/src/sql/guard.ts`. Never execute SQL anywhere else.
- `packages/core` never imports from `apps/*`, Next.js, or the auth library.
- No secrets in the repo. New env vars go in `apps/web/src/env.ts` (Zod) and `.env.example`.
- Unit tests mock LLM calls (MSW). Real-model tests run manually or weekly only.
- TypeScript strict; no `any` without a comment explaining why.
- Name tests by plan ID: `it("T3.4 rejects pg_sleep")`.
- Every API route: validate input with Zod, check the session, check ownership of any ID.

## Next.js 16.4

This Next.js is newer than most training data. Before using an API you are not sure of, read the bundled docs in `apps/web/node_modules/next/dist/docs/`. Notable: `middleware` is now `proxy.ts`; `cacheComponents` is on, so a GET route handler is prerendered unless it awaits `connection()` or reads request data.

## Layout

```
apps/web/         Next.js app (App Router, routes under src/app/[lang]/ for en/ar)
packages/core/    The engine (filled from Stage 2)
packages/db/      Drizzle schema + migrations for the app DB
```

## Commands (from the repo root)

```bash
pnpm install
pnpm db:up          # local Postgres on port 5433 (Docker)
pnpm db:migrate
pnpm dev            # http://localhost:3000
pnpm lint && pnpm typecheck && pnpm test
pnpm test:e2e       # builds and starts the app on port 3200
pnpm db:generate --name <change>   # after editing packages/db/src/schema.ts
```

One `.env` at the repo root (copy `.env.example`) serves every package.
