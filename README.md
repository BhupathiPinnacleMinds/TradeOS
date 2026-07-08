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
- Docker Desktop, or PostgreSQL 16 or later installed locally

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

3. Start PostgreSQL with Docker and confirm it is healthy:

   ```bash
   docker compose up -d postgres
   docker compose ps
   ```

4. Generate the Prisma client, apply migrations, and seed demo data:

   ```bash
   pnpm db:generate
   pnpm db:migrate
   pnpm db:seed
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

The local seed creates:

- 1 demo business: `Demo Tradie Co`
- 1 owner: `owner@demo-tradieos.com`
- 2 staff users
- 5 customers
- 5 jobs
- 3 quotes
- 2 invoices
- 5 notifications
- 3 Tori AI messages

Demo login:

```text
email: owner@demo-tradieos.com
password: password123
```

The mobile app logs in through `POST /api/auth/login`, stores the JWT with
Expo SecureStore on device, and sends that token with dashboard requests. The
dashboard reads `GET /api/dashboard/summary` from PostgreSQL and derives
`businessId` from the logged-in user's JWT.

For Expo Go on a physical phone, `localhost` means the phone itself, not your
computer. Set `apps/mobile/.env` like this before starting Expo:

```bash
EXPO_PUBLIC_API_URL=http://YOUR_COMPUTER_LAN_IP:3000/api
```

Example:

```bash
EXPO_PUBLIC_API_URL=http://192.168.0.234:3000/api
```

## Local development on Windows

For the most reliable local setup on this machine, use the checked-in helper
scripts instead of retyping long Expo commands. They avoid PowerShell quoting
issues with URLs and use the LAN IP that Expo Go needs on iPhone.

Start the API in one PowerShell window:

```powershell
powershell -ExecutionPolicy Bypass -File C:\Users\bhupa\WorkSpace\TradeOS\scripts\start-api-dev.ps1
```

Start Expo for browser/iPhone testing in a second PowerShell window:

```powershell
powershell -ExecutionPolicy Bypass -File C:\Users\bhupa\WorkSpace\TradeOS\scripts\start-mobile-lan-fast.ps1
```

The mobile script sets:

```powershell
EXPO_PUBLIC_API_URL=http://192.168.0.234:3000/api
REACT_NATIVE_PACKAGER_HOSTNAME=192.168.0.234
```

Then scan the Expo QR code with Expo Go. If QR scanning is stubborn, open this
project URL from Expo Go:

```text
exp://192.168.0.234:8081
```

Useful local health checks:

```powershell
Invoke-RestMethod http://localhost:3000/api/health
Invoke-RestMethod http://192.168.0.234:3000/api/health
Invoke-WebRequest -UseBasicParsing http://192.168.0.234:8081/status
```

If Expo Go shows “Could not connect to development server,” tap **Reload JS**
first. If it still fails, close Expo Go, restart the Expo script, and scan the
new QR code.

## Common commands

```bash
pnpm build          # Build all packages and apps
pnpm typecheck      # Type-check the workspace
pnpm lint           # Lint the workspace
pnpm test           # Run tests
pnpm test:e2e       # Exercise the API health endpoint
pnpm db:generate    # Generate the Prisma client
pnpm db:migrate     # Apply local Prisma migrations
pnpm db:seed        # Reset and seed the local demo tenant
pnpm db:studio      # Open Prisma Studio
```

## Architecture rules

- A user belongs to one business and has an `OWNER`, `ADMIN`, or `STAFF` role.
- Business-scoped IDs come from the authenticated JWT and are never trusted from query parameters or request bodies.
- All tenant-owned Prisma models carry a `businessId` and an index beginning with `businessId`.
- Cross-tenant relations use compound keys where practical to prevent accidental linkage.
- The dashboard summary is database-backed and filters every query by the authenticated user's `businessId`.
- Tori actions that communicate or transact remain `DRAFT` until a user confirms them.
- Secrets belong in local `.env` files or a secrets manager; example files contain development placeholders only.

## Current scope

This repository intentionally provides the production-oriented foundation, not complete product features. Domain modules, navigation, authentication boundaries, tenant context, database models, and Tori's approval contract are ready for incremental implementation.
