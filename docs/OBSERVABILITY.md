# Observability

TradieOS uses a small server-side observability foundation for private beta:
structured logs, request correlation IDs, safe exception responses and an
error-monitoring adapter seam. The goal is to make production issues
diagnosable without dumping customer data, secrets, public tokens or Tori
conversation content into logs.

## Request correlation IDs

Every API request receives an `X-Request-Id`.

- A safe incoming `X-Request-Id` is accepted when it is 8-80 characters and
  contains only letters, numbers, `.`, `_`, `:` or `-`.
- Invalid, missing or oversized values are replaced with a server-generated
  UUID.
- The response includes the request ID, and server request/error logs include
  the same value.

Use this value when matching a mobile/web error report to API logs.

## Structured server logs

The API uses `StructuredLogger` instead of ad hoc `console.*` for server-side
operational logs. Production logs are JSON-compatible and include safe fields
such as:

- `level`
- `timestamp`
- `message`
- `requestId`
- `method`
- `route`
- `statusCode`
- `durationMs`
- `businessId`
- `userId`
- `category`
- `event`
- `operation`
- `errorCode`

Logs are written to stdout/stderr so the hosting provider can collect, retain
and search them. TradieOS does not implement in-container file rotation.

## Redaction policy

Logging must never include:

- Authorization headers, JWTs, access tokens or refresh tokens
- Passwords or password hashes
- `DATABASE_URL`, `JWT_SECRET`, provider keys or object-storage credentials
- Raw public quote/invoice tokens or public-token hashes
- Idempotency request payloads, request hashes or raw idempotency keys
- Full SMS/email bodies
- Full Tori conversation messages
- Signed URLs or complete provider request/response payloads

When identifiers are needed, prefer internal tenant-scoped references such as
`businessId`, `userId`, `customerId`, `appointmentId`, `quoteId`, `invoiceId`,
`communicationId` or `idempotencyRecordId`.

## Error handling

Unexpected API exceptions are handled by the global exception filter.

- Expected domain/validation/auth errors remain structured 4xx responses.
- Unexpected errors return a minimal 500 response with a `requestId`.
- Stack traces, Prisma internals, provider messages and secrets are not returned
  to clients.
- Unexpected 5xx errors are logged and sent to the error-monitoring seam.

Example safe 500 response:

```json
{
  "code": "INTERNAL_SERVER_ERROR",
  "message": "Something went wrong. Please try again.",
  "requestId": "..."
}
```

## Error-monitoring seam

`ErrorMonitoringService` currently defaults to `ERROR_MONITORING_PROVIDER=none`.
It captures only unexpected 5xx-class failures and ignores expected 4xx errors
such as validation failures, 404s, 403s and rate-limit responses.

The seam is intentionally vendor-light for private beta. A future Sentry or
equivalent adapter should plug into this service and must continue using the
central redaction policy before sending any event externally.

## Auth and security events

The API logs safe security events:

- `login_success`
- `login_failure`
- `rate_limit_triggered`

These logs include request/category metadata where safe. They must not include
passwords, raw login bodies, Authorization headers or enough information to
change user-existence behaviour.

## Communications and worker logs

The scheduled customer communications worker logs bounded summaries:

- `communications_worker_started`
- `communications_worker_completed`
- `communications_worker_failed`
- `communications_worker_skipped`

Provider delivery records persist safe status fields in the database, including
provider name, provider message id where available, sent/failed timestamps and
safe failure categories. Logs must not include full SMS/email content or raw
provider request/response bodies.

## Idempotency logs

The idempotency service logs safe lifecycle events:

- `idempotency_new`
- `idempotency_replay`
- `idempotency_conflict`

These logs include operation, business/user scope where safe and the internal
`idempotencyRecordId`. They do not log the raw `Idempotency-Key`, request hash,
public token, public scope hash, request payload or response body.

## Tori debug logging

`TORI_DEBUG` must remain disabled in production. Production configuration fails
fast if `TORI_DEBUG=1` or `TORI_DEBUG=true`.

Development debug output may show safe planner facts such as intent, workflow
state, expected slot and branch decisions. It must not log full customer
conversation text, customer contact details, addresses, public links or
provider secrets.

## Environment variables

API observability settings:

- `LOG_LEVEL=info`
- `LOG_FORMAT=json` in production, `pretty` is convenient locally
- `ERROR_MONITORING_PROVIDER=none`
- `SENTRY_DSN=` reserved for a future provider adapter
- `SENTRY_ENVIRONMENT=` reserved for a future provider adapter
- `SENTRY_RELEASE=` reserved for a future provider adapter
- `TORI_DEBUG=0`

## Staging verification

Before private-beta traffic:

1. Start the staging API with `LOG_FORMAT=json` and `LOG_LEVEL=info`.
2. Call an authenticated endpoint and verify `X-Request-Id` is returned.
3. Confirm request logs contain `requestId`, route, method, status and duration.
4. Trigger a safe validation error and confirm it remains a normal 4xx.
5. Trigger a controlled test 500 in a non-production staging-only way and
   confirm the response is sanitized and includes `requestId`.
6. Confirm logs do not include Authorization headers, tokens, customer contact
   payloads, Tori message bodies or provider secrets.

Log retention, indexing, alert routing and incident notification are hosting
provider responsibilities until a dedicated monitoring vendor adapter is added.
