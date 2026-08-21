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

Local development media uploads use endpoint-scoped multipart handling. Do not
increase global JSON body limits for real photos or documents; keep large file
handling on the media upload route or direct object-storage upload path.

Future production mobile builds should use EAS.

Mobile EAS profiles, API URL safety rules, app identifiers, versioning and
mobile-safe environment variables are documented in
[Mobile Release](MOBILE_RELEASE.md). Staging and production builds must provide
an explicit HTTPS `EXPO_PUBLIC_API_URL`; they must not fall back to localhost,
LAN IPs or Expo development URLs.

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

Before high-risk deployments or migrations, confirm the PostgreSQL backup/PITR
state described in [Backup and Recovery](BACKUP_AND_RECOVERY.md). Migration
rollback may require restoring the database backup and redeploying the previous
compatible API version.

## Health checks

Production hosting and load balancers should use separate liveness and
readiness checks:

- Liveness: `GET /api/health`
  - Expected healthy code: `200`
  - Purpose: verifies the API process is alive.
  - Does not depend on PostgreSQL or other external providers.
- Readiness: `GET /api/ready`
  - Expected ready code: `200`
  - Expected not-ready code: `503`
  - Purpose: verifies the API instance can serve normal application traffic.
  - Currently checks PostgreSQL connectivity through the existing Prisma
    application dependency using a tiny `SELECT 1`.

Use `/api/ready` for load-balancer traffic routing. Use `/api/health` for
process liveness/restart decisions. Neither endpoint requires a JWT, and both
are excluded from normal API rate limiting so infrastructure probes are not
blocked by tenant/user throttles.

Readiness does not run migrations and must not be used as a migration
deployment mechanism. Apply migrations separately before or during deployment
with the repository migration command.

## Environment variables

API:

- NODE_ENV
- PORT
- DATABASE_URL
- JWT_SECRET
- JWT_EXPIRES_IN
- CORS_ORIGINS
- TRUST_PROXY
- RATE_LIMIT_ENABLED
- RATE_LIMIT_WINDOW_SECONDS
- RATE_LIMIT_MAX_REQUESTS
- RATE_LIMIT_AUTH_MAX_REQUESTS
- RATE_LIMIT_PUBLIC_READ_MAX_REQUESTS
- RATE_LIMIT_PUBLIC_MUTATION_MAX_REQUESTS
- RATE_LIMIT_TORI_CHAT_MAX_REQUESTS
- RATE_LIMIT_TORI_ACTION_MAX_REQUESTS
- RATE_LIMIT_MEDIA_MAX_REQUESTS
- RATE_LIMIT_INTERNAL_MAX_REQUESTS
- IDEMPOTENCY_ENABLED
- IDEMPOTENCY_IN_PROGRESS_TTL_SECONDS
- IDEMPOTENCY_RETENTION_HOURS
- APP_PUBLIC_URL
- EMAIL_PROVIDER
- CUSTOMER_COMMUNICATIONS_ENABLED
- CUSTOMER_EMAIL_PROVIDER
- CUSTOMER_SMS_PROVIDER
- CUSTOMER_COMMUNICATION_WORKER_ENABLED
- CUSTOMER_COMMUNICATION_WORKER_INTERVAL_SECONDS
- CUSTOMER_COMMUNICATION_WORKER_BATCH_SIZE
- EMAIL_FROM_NAME
- EMAIL_FROM_ADDRESS
- RESEND_API_KEY
- TWILIO_ACCOUNT_SID
- TWILIO_AUTH_TOKEN
- TWILIO_MESSAGING_FROM
- STORAGE_PROVIDER
- STORAGE_LOCAL_PATH
- S3_BUCKET
- S3_REGION
- S3_ENDPOINT
- S3_ACCESS_KEY_ID
- S3_SECRET_ACCESS_KEY
- S3_FORCE_PATH_STYLE
- S3_SIGNED_URL_TTL_SECONDS
- AI_PROVIDER
- OPENAI_API_KEY

Mobile:

- EXPO_PUBLIC_APP_ENV
- EXPO_PUBLIC_API_URL

Invitation email defaults:

- Local development should use `EMAIL_PROVIDER=console`. This prints invite delivery metadata and, outside production, the local invite URL.
- Production should use `EMAIL_PROVIDER=resend` with `RESEND_API_KEY` and `EMAIL_FROM_ADDRESS`.
- If Resend is selected but not fully configured, the API falls back to the console provider so local invitation creation does not fail during setup.
- Set `APP_PUBLIC_URL` to the web/mobile URL used in invitation links, for example `http://localhost:8081` locally.

Production fail-fast configuration:

- `NODE_ENV=production` requires `DATABASE_URL`, a strong non-placeholder
  `JWT_SECRET`, production `CORS_ORIGINS`, and an HTTPS `APP_PUBLIC_URL`.
- `EMAIL_PROVIDER=resend`, `RESEND_API_KEY` and `EMAIL_FROM_ADDRESS` are
  required in production so team invitations do not silently become local-only.
- `CUSTOMER_EMAIL_PROVIDER=resend` and `CUSTOMER_SMS_PROVIDER=twilio` are
  required in production when `CUSTOMER_COMMUNICATIONS_ENABLED` is not `false`.
  Configure `RESEND_API_KEY`, `EMAIL_FROM_ADDRESS`, `TWILIO_ACCOUNT_SID`,
  `TWILIO_AUTH_TOKEN` and `TWILIO_MESSAGING_FROM`.
- `CUSTOMER_COMMUNICATION_WORKER_ENABLED=true` is required in production when
  customer communications are enabled. Use
  `CUSTOMER_COMMUNICATION_WORKER_INTERVAL_SECONDS=300` for the default 5-minute
  cadence and `CUSTOMER_COMMUNICATION_WORKER_BATCH_SIZE=50` for the default
  bounded batch.
- `AI_PROVIDER=openai` requires `OPENAI_API_KEY`; leave `AI_PROVIDER=local` for
  deterministic Tori behaviour.
- `STORAGE_PROVIDER=s3` is required in production. Configure `S3_BUCKET`,
  `S3_REGION`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`. Set
  `S3_ENDPOINT` and `S3_FORCE_PATH_STYLE=true` for Cloudflare R2, MinIO or other
  compatible providers when required.
- `RATE_LIMIT_ENABLED=true` is required in production. Defaults are
  `RATE_LIMIT_WINDOW_SECONDS=60`, `RATE_LIMIT_MAX_REQUESTS=120`,
  `RATE_LIMIT_AUTH_MAX_REQUESTS=10`,
  `RATE_LIMIT_PUBLIC_READ_MAX_REQUESTS=60`,
  `RATE_LIMIT_PUBLIC_MUTATION_MAX_REQUESTS=10`,
  `RATE_LIMIT_TORI_CHAT_MAX_REQUESTS=60`,
  `RATE_LIMIT_TORI_ACTION_MAX_REQUESTS=20`,
  `RATE_LIMIT_MEDIA_MAX_REQUESTS=120` and
  `RATE_LIMIT_INTERNAL_MAX_REQUESTS=10`. Production validation rejects
  disabled rate limiting and zero/negative configured windows or limits.
- `IDEMPOTENCY_ENABLED=true` is required in production. Defaults are
  `IDEMPOTENCY_IN_PROGRESS_TTL_SECONDS=120` and
  `IDEMPOTENCY_RETENTION_HOURS=48`. Protected high-risk mutation routes require
  a stable `Idempotency-Key` header in production unless the route has an
  internal durable fallback key, such as public quote accept/decline and Tori
  draft confirmation.
- Set `TRUST_PROXY=true` only when the API is behind the deployment platform's
  trusted reverse proxy/load balancer. Leave it `false` for direct local/API
  access so arbitrary client `X-Forwarded-For` headers cannot spoof limiter
  identity.
- Do not include localhost, `127.0.0.1` or `0.0.0.0` in production CORS or
  public URLs.

Rate limiting:

- The API applies a configurable global baseline plus stricter endpoint
  policies for auth/login, invitation acceptance, public quote/invoice links,
  Tori chat/action confirmation, media APIs and manual communication processing.
- Health checks are exempt so infrastructure monitoring is not blocked by
  ordinary user traffic.
- Rate-limited responses use HTTP `429`, code `RATE_LIMIT_EXCEEDED`, a
  user-safe message and `Retry-After`.
- The current limiter is in-memory per API process. Run the private beta as one
  API instance, or add a shared store/gateway limiter before horizontal API
  scaling.

Idempotency:

- High-risk mutating APIs use the standard `Idempotency-Key` request header.
  Generate one stable key per user action and reuse it for retries of the same
  action. Do not generate a fresh key for automatic HTTP retries.
- The API stores only SHA-256 hashes of idempotency keys and public scopes. It
  never stores raw public quote tokens or raw header values.
- Same key + same authenticated business/user + same operation + same payload
  returns the original successful JSON response.
- Same key + different payload returns `409 IDEMPOTENCY_KEY_REUSED`.
- In-progress duplicate requests wait briefly for the original request to
  finish, then replay success or return `409 IDEMPOTENCY_REQUEST_IN_PROGRESS`.
- Protected routes include quote creation/send/accept/decline/duplicate,
  quote-to-job conversion, invoice creation/send/payment/void, appointment
  creation/reassignment/status completion, public quote accept/decline, Tori
  draft confirmation and manual customer communications.

Storage:

- Local development can use `STORAGE_PROVIDER=local` and `STORAGE_LOCAL_PATH`.
- Production must use a private S3-compatible bucket. Do not make the bucket
  publicly readable.
- Media previews/downloads use authenticated API authorization and short-lived
  signed URLs.
- Quote and invoice customer access remains controlled by secure public tokens;
  PDF objects stay private in storage.
- Object keys are tenant-scoped under `businesses/{businessId}/...`.

Customer communications:

- Local development can use `CUSTOMER_EMAIL_PROVIDER=local` and
  `CUSTOMER_SMS_PROVIDER=local`; these log safe previews and do not contact real
  providers.
- Production customer email uses Resend.
- Production customer SMS uses Twilio and accepts Australian mobile numbers in
  common local or `+61` formats.
- Provider message IDs are stored on `CustomerCommunication.providerMessageId`
  with a safe `provider` name.
- Provider failures are recorded as `FAILED`; raw credentials, Authorization
  headers and full provider payloads must not be logged.
- Scheduled reminders run through `CustomerCommunicationWorker` when
  `CUSTOMER_COMMUNICATION_WORKER_ENABLED=true`. The worker invokes the same
  communication delivery service used by manual/API flows, so EMAIL routes to
  Resend and SMS routes to Twilio in production.
- The worker is horizontally safe: due rows are atomically claimed as
  `PROCESSING` with processing timestamps before provider delivery. Multiple API
  replicas may tick at the same time without double-sending the same
  communication.
- The worker logs summary counters only: due, claimed, sent, failed, skipped and
  duration. It does not log message bodies, provider credentials, JWTs or token
  hashes.
- Inbound SMS -> Tori is not implemented yet.

## Production requirements before launch

- Strong JWT secret.
- HTTPS API.
- Production database backups.
- Backup/restore rehearsal using the
  [Backup and Recovery](BACKUP_AND_RECOVERY.md) runbook.
- Error monitoring.
- Audit logs for sensitive actions.
- Integration credential encryption.
- Production CORS allowlist.
- Disable development-only demo-token endpoint.
- Private durable object storage for photos, documents, quote PDFs, invoice PDFs
  and receipt PDFs.
- Rate limiting on auth, public-token and Tori endpoints.
