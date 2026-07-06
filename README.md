# TradieOS

TradieOS is an AI-first personal office assistant for Australian tradies. Its assistant, **Tori**, helps prepare quotes, invoices, customer replies, bookings, reminders, follow-ups, and daily priorities.

> **Safety rule:** Tori creates drafts and recommendations only. SMS, email, quotes, and invoices must never be sent without explicit user confirmation.

## Repository layout

```text
apps/
  api/       NestJS API and Prisma data layer
  mobile/    Expo React Native app
packages/
  shared/    Shared TypeScript contracts
```

The platform is multi-tenant. Every domain record is scoped to a business workspace, and authenticated requests derive their `businessId` from the signed-in user rather than request input.

## Prerequisites

- Node.js 22 or later
- pnpm 11 or later
- PostgreSQL 16 or later

## Setup

1. Install dependencies:

   ```bash
   pnpm install
   ```

2. Create local environment files:

   ```bash
   cp apps/api/.env.example apps/api/.env
   cp apps/mobile/.env.example apps/mobile/.env
   ```

3. Start PostgreSQL and update `DATABASE_URL` in `apps/api/.env`. A local
   database is included:

   ```bash
   docker compose up -d postgres
   ```

4. Generate the Prisma client and create the first migration:

   ```bash
   pnpm db:generate
   pnpm db:migrate
   ```

5. Run both applications in separate terminals:

   ```bash
   pnpm dev:api
   pnpm dev:mobile
   ```

The API defaults to `http://localhost:3000/api`. Check it with:

```bash
curl http://localhost:3000/api/health
```

## Common commands

```bash
pnpm build          # Build all packages and apps
pnpm typecheck      # Type-check the workspace
pnpm lint           # Lint the workspace
pnpm test           # Run tests
pnpm test:e2e       # Exercise the API health endpoint
pnpm db:studio      # Open Prisma Studio
```

## Architecture rules

- A user belongs to one business and has an `OWNER`, `ADMIN`, or `STAFF` role.
- Business-scoped IDs come from the authenticated JWT and are never trusted from query parameters or request bodies.
- All tenant-owned Prisma models carry a `businessId` and an index beginning with `businessId`.
- Cross-tenant relations use compound keys where practical to prevent accidental linkage.
- Tori actions that communicate or transact remain `DRAFT` until a user confirms them.
- Secrets belong in local `.env` files or a secrets manager; example files contain development placeholders only.

## Current scope

This repository intentionally provides the production-oriented foundation, not complete product features. Domain modules, navigation, authentication boundaries, tenant context, database models, and Tori's approval contract are ready for incremental implementation.
