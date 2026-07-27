# Deployment

## Overview

TradieOS is currently developed locally with Docker, PostgreSQL, NestJS, and Expo. Future deployment should support a hosted API/database and Expo app distribution.

## Local development

Requirements:

- Node.js 22+
- pnpm 11+
- Docker Desktop or local PostgreSQL

Typical setup:

```bash
pnpm install
docker compose up -d postgres
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm dev:api
pnpm dev:mobile
```

`pnpm db:migrate` is intentionally non-interactive and applies committed
migrations with Prisma `migrate deploy`. When intentionally creating a new local
migration, use `pnpm db:migrate:dev`.

Windows helper scripts:

```powershell
powershell -ExecutionPolicy Bypass -File C:\Users\bhupa\WorkSpace\TradeOS\scripts\start-api-dev.ps1
powershell -ExecutionPolicy Bypass -File C:\Users\bhupa\WorkSpace\TradeOS\scripts\start-mobile-lan-fast.ps1
```

## Docker

Current Docker usage:

- PostgreSQL local development container.

Future Docker usage:

- API container.
- Worker container.
- Migration job.

## Railway

Railway is a possible future API/PostgreSQL deployment target.

Requirements:

- API service
- PostgreSQL service
- environment variables
- migration command
- health check

## Render

Render is a possible future API deployment target.

Requirements:

- web service
- PostgreSQL database
- build command
- start command
- health check

## Supabase

Supabase may be used for managed PostgreSQL, auth extensions, storage, or realtime features. If used, it must not weaken the existing business isolation model.

## Expo

Expo supports:

- Expo Go for development
- EAS Build for native builds
- EAS Submit for app store submission

The mobile app uses Expo SDK-compatible native modules for field evidence:

- `expo-image-picker` for camera and photo-library selection.
- `expo-document-picker` for PDFs, Word, Excel and text documents.
- `expo-file-system` for authenticated cached file reads/downloads and local
  upload byte transfer.

Camera and photo-library permission copy lives in `apps/mobile/app.json`.
Re-run `expo install --check` after Expo SDK upgrades to verify the bundled
native module versions remain compatible with Expo Go and EAS builds.

Future production mobile builds should use EAS.

## Future CI/CD

CI should run:

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:e2e
```

Deployment should include:

- database migration
- API deploy
- smoke test
- mobile build if applicable

## Environment variables

API:

- NODE_ENV
- PORT
- DATABASE_URL
- JWT_SECRET
- JWT_EXPIRES_IN
- CORS_ORIGINS
- APP_PUBLIC_URL
- EMAIL_PROVIDER
- EMAIL_FROM_NAME
- EMAIL_FROM_ADDRESS
- RESEND_API_KEY

Mobile:

- EXPO_PUBLIC_API_URL

Invitation email defaults:

- Local development should use `EMAIL_PROVIDER=console`. This prints invite delivery metadata and, outside production, the local invite URL.
- Production should use `EMAIL_PROVIDER=resend` with `RESEND_API_KEY` and `EMAIL_FROM_ADDRESS`.
- If Resend is selected but not fully configured, the API falls back to the console provider so local invitation creation does not fail during setup.
- Set `APP_PUBLIC_URL` to the web/mobile URL used in invitation links, for example `http://localhost:8081` locally.

## Production requirements before launch

- Strong JWT secret.
- HTTPS API.
- Production database backups.
- Error monitoring.
- Audit logs for sensitive actions.
- Integration credential encryption.
- Production CORS allowlist.
- Disable development-only demo-token endpoint.
