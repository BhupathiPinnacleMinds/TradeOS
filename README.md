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

   For normal quote-module development after pulling existing data, run only:

   ```bash
   pnpm db:generate
   pnpm db:migrate
   ```

   Do not run `pnpm db:seed` unless you intentionally want to refresh local demo
   data.

5. Run both applications in separate terminals:

   ```bash
   pnpm dev:api
   pnpm dev:mobile
   ```

The API defaults to `http://localhost:3000/api`. Check it with:

```bash
curl http://localhost:3000/api/health
```

Quote sending in local development uses the console email/provider seam and
logs a quote preview URL. Real customer email delivery and public customer
acceptance tokens require the production email/customer-portal provider setup.

The local seed creates:

- 1 demo business: `Demo Tradie Co`
- active local demo users for every supported role
- 5 customers
- demo jobs and appointments for owner, technician, scheduler and read-only
  workflow testing
- 3 quotes
- 2 invoices
- Accounts Receivable demo data derived from real invoice/payment records
- 5 notifications
- 3 Tori AI messages
- demo media/document metadata and tiny local placeholder files under
  `apps/api/.local-storage`

See [Local Test Accounts](./docs/LOCAL_TEST_ACCOUNTS.md) for local-only demo
emails, the shared local password, landing screens, permitted modules, blocked
modules and assigned seeded data.

The mobile app logs in through `POST /api/auth/login`, stores the JWT with
Expo SecureStore on device, and sends that token with dashboard requests. The
dashboard reads `GET /api/dashboard/summary` from PostgreSQL and derives
`businessId` from the logged-in user's JWT.

Accounts Receivable is available from More for permitted financial/read-only
roles. Dashboard financial cards open the AR screen, which calls
`GET /api/invoices/accounts-receivable`. Payment receipt PDFs are generated on
demand from Invoice Details via
`GET /api/invoices/:id/payments/:paymentId/receipt`.

Mobile evidence capture uses Expo-compatible native modules:

- camera/photo library: `expo-image-picker`
- PDFs, Word, Excel and text files: `expo-document-picker`
- authenticated cached reads/uploads: `expo-file-system`

Open evidence from My Day, Appointment Details, Job Details or Customer Details
so the upload is attached to an existing tenant-scoped appointment, job or
customer. Real photos and documents upload as multipart binary data through the
authenticated Media API; only the development demo file uses tiny Base64 JSON.

Local media/document storage defaults to:

```bash
STORAGE_PROVIDER=local
STORAGE_LOCAL_PATH=.local-storage
```

For production, use an S3-compatible object store by setting
`STORAGE_PROVIDER=s3` and the S3 variables listed in `apps/api/.env.example`.
Do not commit uploaded files or secret keys.

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

For the most reliable local setup on Windows, start Docker Desktop manually,
then use this daily workflow from a normal PowerShell window.

Morning startup:

```powershell
pnpm dev:local
```

This launcher:

- verifies Docker Desktop is running
- verifies PostgreSQL is reachable
- verifies the Prisma schema is valid
- verifies Prisma migrations are current
- reuses an already healthy API or Metro instance
- stops only stale verified TradeOS listeners on ports `3000`, `8081` and
  `8082`
- opens the API in a normal visible terminal
- opens Expo/Metro in a second normal visible terminal
- detects your current LAN IP
- sets `EXPO_PUBLIC_API_URL=http://<LAN-IP>:3000/api`
- starts Expo with `--lan --clear`
- never seeds, resets or deletes database data

Work all day with the two visible terminals open.

Shutdown:

```powershell
pnpm dev:stop
```

This stops only verified TradeOS API/Metro listeners and leaves Docker Desktop
and PostgreSQL running.

Troubleshooting without starting anything:

```powershell
pnpm dev:doctor
```

`dev:doctor` checks Docker, PostgreSQL, Prisma, API health, Metro, LAN IP, the
mobile API URL, local ports and Expo configuration.

Manual fallback commands are still available if you want to run each side
yourself. They avoid PowerShell quoting issues with URLs and use the LAN IP that
Expo Go needs on iPhone.

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

When schema, API routes or seeded demo records change, use this local startup
order so the phone/browser does not hold stale route or appointment state:

```powershell
pnpm db:generate
pnpm db:migrate
pnpm db:seed
powershell -ExecutionPolicy Bypass -File C:\Users\bhupa\WorkSpace\TradeOS\scripts\start-api-dev.ps1
powershell -ExecutionPolicy Bypass -File C:\Users\bhupa\WorkSpace\TradeOS\scripts\start-mobile-lan-fast.ps1
```

If Expo still shows stale appointment screens after reseeding, log out and log
back in, then open **My Day** and pull to refresh. The app should use the current
appointment IDs returned by `/api/appointments/my-day`, not old seed IDs from a
previous navigation state.

Media route smoke checks:

```powershell
Invoke-RestMethod http://localhost:3000/api/health

$login = Invoke-RestMethod http://localhost:3000/api/auth/login `
  -Method POST `
  -ContentType 'application/json' `
  -Body '{"email":"mia@demo-tradieos.com","password":"password123"}'

$headers = @{ Authorization = "Bearer $($login.token)" }
Invoke-RestMethod http://localhost:3000/api/media -Headers $headers
$myDay = Invoke-RestMethod http://localhost:3000/api/appointments/my-day -Headers $headers
$appointmentId = $myDay.nextAppointment.id
Invoke-RestMethod "http://localhost:3000/api/media?appointmentId=$appointmentId" -Headers $headers
```

## Common commands

```bash
pnpm dev:doctor    # Windows: check Docker, DB, Prisma, API, Metro, LAN IP and Expo config
pnpm dev:local     # Windows: verify DB, stop stale local listeners, start API + Expo in visible terminals
pnpm dev:stop      # Windows: stop only verified TradeOS API/Metro listeners
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
