# TradieOS Production Readiness Audit – Phase 1

Audit date: 2026-08-19

Overall status: NOT READY for real-user production deployment.

TradieOS has a strong multi-tenant foundation and many production-oriented seams are already in place: business-scoped data, hashed public tokens, Prisma migrations, role-aware services, audit logs, local-safe communication providers and explicit Tori confirmation drafts. The current blockers are mostly production infrastructure, hardening and provider-readiness gaps rather than a need to redesign the product architecture.

## P0 blockers before production

- Production configuration must fail fast. `NODE_ENV=production` now requires a strong `JWT_SECRET`, `DATABASE_URL`, strict `CORS_ORIGINS`, a public HTTPS app URL and a real invitation email provider.
- Public mutation/read endpoints now have production rate limiting. This
  includes login/register, invitation validation/acceptance, public quote
  view/accept/decline, public invoice view and Tori chat/confirmation.
- Durable idempotency is implemented for high-risk financial, public and Tori
  mutations. Protected routes persist request hashes and successful responses in
  `IdempotencyRecord`, scoped by business/user/operation/key or hashed public
  scope/operation/key. Production config requires idempotency to stay enabled.

## P1 issues before beta

- DB-backed readiness is implemented through `GET /api/ready`.
- Structured production logging and error-monitoring foundation is implemented:
  API requests carry `X-Request-Id`, unexpected errors return sanitized
  responses, sensitive fields are centrally redacted, and safe auth,
  rate-limit, communications-worker and idempotency events are logged.
- PostgreSQL and S3/R2 backup/restore operations are documented in
  [Backup and Recovery](BACKUP_AND_RECOVERY.md). Complete a staging restore
  rehearsal before inviting private-beta users.
- Production/staging mobile EAS profiles and API URL validation are documented
  in [Mobile Release](MOBILE_RELEASE.md). Staging and production builds now
  require explicit HTTPS API URLs and do not silently fall back to localhost.
- Existing Prisma `onDelete: SetNull` warnings for required compound
  `businessId` relations are resolved. Historical tenant links now restrict
  parent hard deletion while normal product flows continue to use
  archive/deactivate semantics.
- Account recovery and session revocation foundation is implemented. Password
  reset tokens are one-time use, hash-only and expiring; JWTs include
  `authVersion`; password reset/change, sign-out-all-devices and member
  suspension/reactivation/removal revoke previously issued access tokens.
- Connect a production error-monitoring vendor adapter and alert routing when
  the private-beta hosting target is selected.
- Add production CORS origin review for deployed web/mobile hosts.
- Add regression coverage for production config validation, public customer links, public-token throttling and scheduled-worker idempotency.

## P2 post-launch improvements

- Add refresh tokens or short-lived access-token rotation.
- Add online payment gateway integration if customer card payments become part of the launch scope.
- Add full queue-backed background jobs for reminders, PDFs and file-processing work.
- Add analytics/product telemetry with privacy controls.
- Add a real OpenAI-backed Tori provider when deterministic Phase 1 behaviour is no longer sufficient.
- Add offline/mobile retry queues for field workflows.

## Security findings

- Passwords are hashed server-side and demo plaintext passwords are seed-only/local documentation.
- JWT authentication and service-level role checks are present across the app. UI hiding is treated as convenience; API guards/services remain the authority.
- Public quote/invoice links use random tokens and store only token hashes in the database.
- Invitation tokens are hashed and single-use with expiry/cancel/accept fields.
- Password reset tokens are hashed, single-use and expiring. Reset requests are
  neutral so they do not reveal whether an email exists.
- User-level `authVersion` provides durable stateless-JWT revocation after
  password reset, password change, sign-out-all-devices and team member
  suspension/reactivation/removal.
- Production gaps: request auditing for all sensitive financial mutations and
  secret-management runbook.
- Global and endpoint-specific API rate limiting is implemented with structured
  `429 RATE_LIMIT_EXCEEDED` responses, `Retry-After`, authenticated
  user/business buckets, public IP buckets and explicit trusted-proxy handling.
  The current store is in-memory per API process and is suitable only for a
  single-instance private beta.
- High-risk double-submit protection uses hash-only idempotency records.
  Reusing the same `Idempotency-Key` with the same operation and payload replays
  the original successful response; reusing it with a different payload returns
  `409 IDEMPOTENCY_KEY_REUSED`.
- API observability uses structured logs and a central redaction policy. Logs
  must not contain Authorization headers, JWTs, provider secrets, raw public
  tokens, public-token hashes, signed URLs, idempotency request payloads, full
  SMS/email bodies or full Tori conversation messages.
- In-app notifications are database-backed and recipient-scoped. They are safe
  for private beta operational alerts, but they are not background push
  notifications; Expo Push, FCM/APNs, SMS and email notification delivery remain
  separate future work.

## Multi-tenant findings

- Core records are business-scoped with `businessId` on customers, customer sites, jobs, appointments, quotes, invoices, payments, messages, notifications, media and AI conversations.
- Services consistently resolve data through the authenticated user’s `businessId`.
- Public quote/invoice endpoints resolve through token hashes and return only customer-safe payloads.
- Continue requiring new modules to include `businessId`, tenant-scoped unique constraints where appropriate and negative business-isolation tests.

## Database and migration findings

- Prisma is the source of truth, with committed migrations for the current schema.
- Business-level sequences exist for human-readable numbers.
- Public tokens, communication idempotency keys and core entity identifiers have useful indexes/unique constraints.
- Generic idempotency records are stored in `IdempotencyRecord` with hashed
  keys, hashed public scopes, request hashes, operation names, status, cached
  successful JSON responses and expiry timestamps. Raw customer tokens and raw
  `Idempotency-Key` header values are not stored.
- Compound optional relations that include `businessId` use `Restrict` for
  parent hard deletes instead of invalid `SetNull` semantics. This preserves
  tenant scoping and traceability for assignment, quote/job/invoice,
  communication, document and media history.
- `PasswordResetToken` stores only SHA-256 token hashes, expiry and lifecycle
  timestamps. Raw reset tokens are not persisted.
- Before production, run the current migrations against staging from a clean database and from a backup restore to prove both paths.
- Do not use local seed/reset commands in production.

## Tori production-safety findings

- Tori’s Phase 1 behaviour remains confirmation-first: it can prepare drafts and recommendations, but user confirmation is required before creating customers, jobs, appointments, quotes, invoices or communications.
- Recent hardening prevents stale workflows from overriding strong new root commands and preserves explicit current-turn entities.
- Tori currently uses local/deterministic logic unless `AI_PROVIDER=openai` is intentionally configured.
- Production requirements: keep `TORI_DEBUG` disabled by default and verify
  OpenAI key handling before enabling the OpenAI provider. Production
  configuration now fails fast if verbose Tori debugging is enabled. Tori
  confirmations are now protected by durable idempotency keyed by the confirmed
  draft id plus any supplied `Idempotency-Key`; Tori chat and confirm endpoints
  are also protected by dedicated API rate-limit policies.

## Mobile production configuration findings

- Local Expo workflows are documented and use LAN API URLs for physical-device testing.
- Production mobile builds must provide `EXPO_PUBLIC_API_URL` through the build profile and must not rely on localhost fallback.
- EAS profiles should separately define development, preview and production API URLs.
- Public quote/invoice URLs should use `APP_PUBLIC_URL`; the API now prefers that value when building customer links.

## File and media storage findings

- Local evidence upload/download works through authenticated API routes and endpoint-scoped multipart handling.
- Archive/restore preserves records and storage objects for future retention/legal-hold policies.
- Production storage code is implemented through the existing `StorageProvider`
  abstraction using private S3-compatible object storage for AWS S3, Cloudflare
  R2, MinIO or compatible services.
- Object keys are tenant-prefixed under `businesses/{businessId}/...` and
  scoped by appointment, job, customer, quote, invoice or payment where the
  domain context is available.
- Quote PDFs, invoice PDFs and payment receipt PDFs now use the same durable
  provider path as field media.
- Before launch, provision a private bucket, configure lifecycle/backup policy,
  run a real-provider smoke test and define virus scanning/retention policy.

## Background scheduler findings

- Production scheduled customer communication processing is implemented through
  `CustomerCommunicationWorker`.
- The worker is disabled by default and enabled explicitly with
  `CUSTOMER_COMMUNICATION_WORKER_ENABLED=true`.
- The default cadence is every 5 minutes
  (`CUSTOMER_COMMUNICATION_WORKER_INTERVAL_SECONDS=300`) with a default batch
  size of 50 (`CUSTOMER_COMMUNICATION_WORKER_BATCH_SIZE=50`).
- Horizontal safety is provided by atomic PostgreSQL/Prisma claims:
  `SCHEDULED -> PROCESSING` with `processingStartedAt` and
  `processingExpiresAt`. Concurrent API replicas or overlapping ticks cannot
  double-send a claimed communication.
- Stale `PROCESSING` rows may be reclaimed after the processing lock expires.
- The delivery service rechecks appointment, quote and invoice eligibility
  before provider calls so stale scheduled reminders are cancelled rather than
  sent.

## Customer communication provider findings

- Production customer email delivery is implemented through Resend behind the
  existing `CustomerCommunicationProvider` abstraction.
- Production customer SMS delivery is implemented through Twilio behind the same
  abstraction, with Australian mobile normalisation to E.164.
- Local development providers remain available and safe; production config
  fails fast unless real customer providers are configured while customer
  communications are enabled.
- Provider success records `provider`, `providerMessageId`, `sentAt` and
  `SENT`; provider failure records `provider`, `failedAt`, safe
  `failureReason` and `FAILED`.
- Inbound SMS -> Tori is not implemented yet.

## Recommended production infrastructure

- API: hosted Node/Nest service with HTTPS, request logging, health checks and error monitoring.
- Use `GET /api/health` as process liveness and `GET /api/ready` as
  load-balancer readiness. Readiness checks PostgreSQL through Prisma and
  returns `503` without raw database details when the dependency is unavailable.
- Database: managed PostgreSQL with PITR backups, migration job, staging environment and restore drills.
- Storage: S3-compatible object storage with private buckets, signed URLs, retention policy and backup/lifecycle rules.
- Email: Resend or equivalent transactional email provider for invitations and customer email.
- SMS: Twilio for outbound customer SMS now and future inbound SMS webhook
  support later.
- Jobs: queue/worker or cron platform for reminders, follow-ups, PDF generation and retryable delivery.
- Secrets: managed secret store; no production secrets in repository or local `.env` files.
- Mobile: EAS builds with environment-specific API URLs and release-channel discipline.
- Logs: structured JSON stdout/stderr collection with retention/search handled
  by the hosting provider; see [Observability](OBSERVABILITY.md).

## Required production environment variables

API:

- `NODE_ENV=production`
- `DATABASE_URL`
- `JWT_SECRET` with at least 32 non-placeholder characters
- `CORS_ORIGINS` with deployed HTTPS origins only
- `TRUST_PROXY=true` only behind a trusted reverse proxy/load balancer
- `LOG_LEVEL=info`
- `LOG_FORMAT=json`
- `ERROR_MONITORING_PROVIDER=none` until a production adapter is connected
- `TORI_DEBUG=0`
- `RATE_LIMIT_ENABLED=true`
- `RATE_LIMIT_WINDOW_SECONDS=60`
- `RATE_LIMIT_MAX_REQUESTS=120`
- `RATE_LIMIT_AUTH_MAX_REQUESTS=10`
- `RATE_LIMIT_PUBLIC_READ_MAX_REQUESTS=60`
- `RATE_LIMIT_PUBLIC_MUTATION_MAX_REQUESTS=10`
- `RATE_LIMIT_TORI_CHAT_MAX_REQUESTS=60`
- `RATE_LIMIT_TORI_ACTION_MAX_REQUESTS=20`
- `RATE_LIMIT_MEDIA_MAX_REQUESTS=120`
- `RATE_LIMIT_INTERNAL_MAX_REQUESTS=10`
- `IDEMPOTENCY_ENABLED=true`
- `IDEMPOTENCY_IN_PROGRESS_TTL_SECONDS=120`
- `IDEMPOTENCY_RETENTION_HOURS=48`
- `APP_PUBLIC_URL` with the customer-facing HTTPS app URL
- `APP_RESET_PASSWORD_URL` with the HTTPS password reset URL, or omit to use
  `APP_PUBLIC_URL`
- `PASSWORD_RESET_TOKEN_TTL_MINUTES=60`
- `EMAIL_PROVIDER=resend`
- `CUSTOMER_COMMUNICATIONS_ENABLED=true`
- `CUSTOMER_EMAIL_PROVIDER=resend`
- `CUSTOMER_SMS_PROVIDER=twilio`
- `CUSTOMER_COMMUNICATION_WORKER_ENABLED=true`
- `CUSTOMER_COMMUNICATION_WORKER_INTERVAL_SECONDS=300`
- `CUSTOMER_COMMUNICATION_WORKER_BATCH_SIZE=50`
- `RESEND_API_KEY`
- `EMAIL_FROM_ADDRESS`
- `EMAIL_FROM_NAME`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_MESSAGING_FROM`
- `STORAGE_PROVIDER=s3`
- `S3_BUCKET`
- `S3_REGION`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`
- `S3_ENDPOINT` for Cloudflare R2, MinIO or other compatible providers when
  required
- `S3_FORCE_PATH_STYLE=true` when required by the provider
- `S3_SIGNED_URL_TTL_SECONDS` optional, default `300`
- `AI_PROVIDER=openai` and `OPENAI_API_KEY` only when the OpenAI-backed Tori provider is enabled

Mobile:

- `EXPO_PUBLIC_API_URL` set to the deployed API `/api` base URL

## Exact next task recommendation

Implement the next production readiness slice:

1. Select the private-beta hosting target and configure structured JSON log
   collection/retention for API stdout/stderr.
2. Connect an error-monitoring vendor adapter to `ErrorMonitoringService` if
   real incident capture is required before beta.
3. Run the observability staging verification checklist in
   [Observability](OBSERVABILITY.md).
