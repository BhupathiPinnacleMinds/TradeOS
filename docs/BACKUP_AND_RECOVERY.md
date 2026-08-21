# TradieOS Backup and Recovery Runbook

Status: private-beta operational runbook.

TradieOS stores critical business state in PostgreSQL and stores photos,
documents, quote PDFs, invoice PDFs and receipt PDFs in private durable object
storage. A useful recovery plan must protect both systems and treat scheduled
communications carefully so a restore rehearsal does not contact real
customers.

This runbook is repository-specific, but it does not assume a final production
hosting vendor. Prefer managed-provider backup and point-in-time recovery
features where available.

## Current persistence architecture

- PostgreSQL is the system of record and is accessed through Prisma.
- Local development PostgreSQL is defined in `docker-compose.yml` as the
  `postgres` service using image `postgres:16-alpine` and the persistent Docker
  volume `tradieos_postgres_data`.
- Prisma migrations are committed under `apps/api/prisma/migrations`.
- Production migrations are applied with `pnpm db:migrate`, which runs Prisma
  `migrate deploy`.
- Application readiness is exposed at `GET /api/ready` and checks PostgreSQL
  connectivity through the existing Prisma dependency.
- Local media storage can use `STORAGE_PROVIDER=local`.
- Production media/PDF storage must use `STORAGE_PROVIDER=s3` with a private
  S3-compatible bucket. Object keys are tenant-scoped under
  `businesses/{businessId}/...`.
- Scheduled customer communications are processed by
  `CustomerCommunicationWorker` when
  `CUSTOMER_COMMUNICATION_WORKER_ENABLED=true`.

## Recovery objectives for private beta

Recommended private-beta targets:

- RPO: 15 minutes or better when managed PostgreSQL point-in-time recovery is
  available; otherwise at most 24 hours with nightly backups.
- RTO: 4 hours for ordinary restore from provider backup; 8 hours for a full
  database plus object-storage recovery.

These are recommended operating targets, not contractual guarantees. Tighten
them before a broader production launch.

## Production PostgreSQL backup strategy

Minimum requirements:

- Use a managed PostgreSQL provider with automated backups.
- Enable point-in-time recovery when the provider supports it.
- Keep at least 7 days of recoverable history for private beta.
- Prefer 30 days of retention for daily backups once real paying customers are
  active.
- Take or confirm a fresh backup before high-risk deployments, manual data
  repair, major Prisma migrations or provider maintenance.
- Store backups encrypted at rest.
- Restrict backup access to named administrators who need operational access.
- Do not commit credentials, dump files or provider backup URLs to Git.
- Do not rely on a developer laptop as the only production backup copy.
- Rotate or revoke backup/storage/database access immediately if credentials
  are suspected to be compromised.

If the selected provider exposes both daily snapshots and continuous WAL/PITR,
use PITR for precise incident recovery and snapshots for simpler full-database
restore points.

## Manual database backup procedure

Use provider tooling first. If provider tooling is unavailable, create a manual
PostgreSQL dump from a trusted operations environment with `pg_dump`.

Use placeholders only; never paste real credentials into documentation,
tickets, chat or Git history.

Recommended format:

```bash
export DATABASE_URL="<production-postgres-connection-string>"
export BACKUP_TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
pg_dump "$DATABASE_URL" \
  --format=custom \
  --compress=9 \
  --no-owner \
  --no-privileges \
  --file="tradieos-postgres-${BACKUP_TIMESTAMP}.dump"
```

Filename convention:

```text
tradieos-postgres-YYYYMMDDTHHMMSSZ.dump
```

Storage requirements:

- Upload the dump to encrypted provider backup storage or a restricted private
  operations bucket.
- Record the source environment, timestamp, operator and reason for the backup
  in the operations log.
- Protect the dump as sensitive production data.
- Delete local temporary copies after upload and verification.

## Restore rehearsal procedure

Never rehearse restores against the live production database.

Use a staging or isolated restore database.

1. Create a new staging/restore PostgreSQL database.
2. Configure the staging API with a staging `DATABASE_URL`.
3. Disable automatic customer communications:

   ```bash
   CUSTOMER_COMMUNICATION_WORKER_ENABLED=false
   CUSTOMER_COMMUNICATIONS_ENABLED=false
   CUSTOMER_EMAIL_PROVIDER=local
   CUSTOMER_SMS_PROVIDER=local
   EMAIL_PROVIDER=console
   ```

4. Restore the dump:

   ```bash
   pg_restore \
     --clean \
     --if-exists \
     --no-owner \
     --no-privileges \
     --dbname="<staging-postgres-connection-string>" \
     "tradieos-postgres-YYYYMMDDTHHMMSSZ.dump"
   ```

5. Run Prisma validation against the restore database:

   ```bash
   pnpm db:generate
   pnpm --filter @tradieos/api exec prisma validate
   pnpm --filter @tradieos/api exec prisma migrate status
   ```

6. Start the API against the restore database.
7. Verify liveness and readiness:

   ```bash
   curl -i https://<staging-api-host>/api/health
   curl -i https://<staging-api-host>/api/ready
   ```

8. Log in with a staging-safe account or test operator account.
9. Validate tenant-safe counts where appropriate:
   - businesses
   - users/members
   - customers
   - jobs
   - appointments
   - quotes
   - invoices
   - payments
   - media records
   - customer communications
   - idempotency records
10. Spot-check key tenant records through the application UI/API.
11. Verify important media/PDF references still resolve through authenticated
    preview/download flows.
12. Confirm no real email/SMS provider credentials are present in the staging
    restore environment unless explicitly testing delivery with safe recipients.

Do not run `pnpm db:seed`, `prisma migrate reset` or
`prisma db push --force-reset` during production or restore operations.

## Production restore procedure

Use this only during a real incident after deciding the restore point and
notifying stakeholders.

1. Stop or drain application traffic if writes may continue during recovery.
2. Disable scheduled communications on the restore target:
   `CUSTOMER_COMMUNICATION_WORKER_ENABLED=false`.
3. Select the restore source:
   - provider point-in-time recovery timestamp; or
   - named backup snapshot; or
   - manual `pg_dump` artifact.
4. Restore into a new database instance when possible. Avoid overwriting the
   only production database until the restore has been verified.
5. Point a staging API instance at the restored database first.
6. Run `prisma migrate status`.
7. Verify `GET /api/health` and `GET /api/ready`.
8. Validate tenant-safe record counts and key customer/job/quote/invoice flows.
9. Verify media/PDF object references.
10. Deploy or re-point the production API to the restored database.
11. Re-enable customer communications only after confirming stale scheduled rows
    will not send incorrect messages.
12. Record the incident timeline, restore source, data-loss window and follow-up
    actions.

## Migration safety and rollback

Safe deployment sequence:

1. Confirm automated backup/PITR is healthy.
2. Take or mark a manual restore point before high-risk migrations.
3. Deploy or run migrations with:

   ```bash
   pnpm db:migrate
   ```

4. Confirm:

   ```bash
   pnpm --filter @tradieos/api exec prisma migrate status
   ```

5. Start the new API version.
6. Check:
   - `GET /api/health`
   - `GET /api/ready`
7. Run smoke tests for login, dashboard, customers, jobs, appointments, quotes,
   invoices, media and communications.

Production must not use:

- `prisma migrate reset`
- `prisma db push --force-reset`
- seed scripts
- ad hoc destructive SQL without an incident/change plan

Prisma migrations are forward migrations. Automatic down migrations are not
available. If rollback requires undoing a bad schema/data migration, the normal
private-beta rollback is:

1. restore PostgreSQL from a known-good backup/PITR point;
2. deploy the previous compatible API version;
3. verify `/api/ready`;
4. validate core tenant data and media/PDF references.

## S3/R2 media and PDF backup strategy

Production storage must be a private S3-compatible bucket. Do not make the
bucket public.

Protect these object classes:

- job and appointment photos;
- documents;
- quote PDFs;
- invoice PDFs;
- payment/receipt PDFs.

Minimum private-beta storage requirements:

- Enable bucket versioning when supported.
- Enable provider-side encryption at rest.
- Restrict bucket access to the API runtime and backup/operations users.
- Keep object keys private and tenant-scoped.
- Use signed URLs through the API for preview/download.
- Configure lifecycle rules deliberately; do not auto-delete active customer
  evidence or PDFs without a retention policy.
- Enable accidental-deletion recovery where the provider supports it, such as
  object versioning, soft delete or retention lock.
- Consider secondary replication/backups after private beta if customer volume
  or compliance requirements increase.

Cloudflare R2, AWS S3, MinIO and other S3-compatible providers differ in
versioning, lifecycle and replication features. Choose equivalent controls from
the selected provider.

## Consistency between PostgreSQL and object storage

The database stores object references. Object storage stores the actual bytes.

After a database restore to an older point in time:

- restored DB rows may reference objects that still exist;
- object storage may contain newer orphaned objects created after the restored
  DB snapshot;
- DB rows may reference missing objects if storage objects were deleted
  separately.

Private-beta recovery strategy:

- Prefer restoring PostgreSQL to a point where object storage still contains all
  referenced keys.
- Preserve object versions/deletion recovery long enough to cover the database
  backup retention window.
- After restore, spot-check important media/PDF records by opening authenticated
  preview/download URLs.
- Treat orphaned objects as harmless until a future reconciliation tool exists.
- If a referenced object is missing, keep the DB record for audit/history and
  record the missing-object incident before attempting any manual repair.

No automated reconciliation service exists yet.

## Communications safety during restore

Restored scheduled communication rows may represent old appointment reminders,
quote follow-ups or invoice/payment reminders.

During restore rehearsal or staging verification, always use safe settings:

```bash
CUSTOMER_COMMUNICATION_WORKER_ENABLED=false
CUSTOMER_COMMUNICATIONS_ENABLED=false
CUSTOMER_EMAIL_PROVIDER=local
CUSTOMER_SMS_PROVIDER=local
EMAIL_PROVIDER=console
```

Do not connect staging restore environments to real Resend/Twilio credentials
unless the test plan uses approved safe recipients.

Before re-enabling production communications after a real restore:

- review due `CustomerCommunication` rows;
- confirm old reminders should still be sent;
- confirm provider configuration points to production only after verification;
- re-enable the worker deliberately.

## Idempotency and worker records after restore

Backups should preserve `CustomerCommunication` claim state and
`IdempotencyRecord` rows consistently with the rest of the database.

Do not casually delete:

- idempotency records;
- scheduled communication rows;
- `PROCESSING` communication claim fields.

The communication worker already uses claim expiry. Stale `PROCESSING` rows can
be reclaimed after `processingExpiresAt`, so manual resetting is normally not
needed. If a manual reset is considered during an incident, document the exact
rows and reason first, and ensure the reset cannot double-send customer
communications.

## Disaster scenarios

### A. API deployment failure

1. Keep the current database untouched.
2. Roll back to the previous API version.
3. Check `/api/health` and `/api/ready`.
4. Run a smoke test.
5. Review logs and fix forward.

### B. Bad schema migration

1. Stop writes or drain traffic.
2. Determine whether a forward fix is safer than restore.
3. If restore is required, restore PostgreSQL from the pre-migration backup or
   PITR timestamp.
4. Deploy the previous compatible API version.
5. Verify readiness and core data.

### C. Accidental DB record deletion

1. Identify affected business, table and timeframe.
2. Restore backup/PITR into staging.
3. Compare affected records safely.
4. Prefer application-supported restore actions when they exist.
5. If manual repair is required, write a reviewed SQL plan and take a fresh
   backup first.

### D. PostgreSQL instance failure

1. Use managed provider failover/PITR where available.
2. Restore to a new instance if failover is unavailable.
3. Update `DATABASE_URL` securely.
4. Start API and verify `/api/ready`.
5. Run smoke tests.

### E. Storage object deletion

1. Use object versioning/deletion recovery if enabled.
2. Restore the specific object key/version.
3. Verify authenticated preview/download.
4. If unrecoverable, record the missing-object incident and preserve the DB
   audit record.

### F. API server/container loss

1. Start a fresh API instance with the same environment configuration.
2. Do not restore the database unless data is actually lost.
3. Verify `/api/health` and `/api/ready`.
4. Confirm media signed URLs and communications providers still work.

### G. Communication provider outage

1. Leave PostgreSQL and object storage untouched.
2. Keep scheduled communication rows for retry/history.
3. Pause the worker if repeated sends would create noisy failures.
4. Resume after provider recovery and monitor worker summary counters.

## Production launch checklist

Before private beta:

- Managed PostgreSQL backups enabled.
- PITR enabled or daily backup retention documented.
- Restore rehearsal completed in staging.
- Manual backup process tested with placeholders/staging credentials.
- Private S3-compatible bucket provisioned.
- Bucket versioning or equivalent deletion recovery enabled where supported.
- Bucket access restricted and encrypted at rest.
- Communications worker disable procedure verified in staging.
- Provider credentials are not present in restore rehearsal environments unless
  deliberately testing safe delivery.
- `/api/health` and `/api/ready` configured in hosting/load balancer checks.
- Operators know where backup artifacts and restore runbooks live.
