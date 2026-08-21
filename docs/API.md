# API

## Overview

TradieOS uses a REST API built with NestJS. API routes are prefixed with:

```text
/api
```

## Idempotency

High-risk mutating endpoints accept the standard `Idempotency-Key` header.
Clients should generate one stable key per user action and reuse that same key
for retries of the same request.

Protected behaviour:

- same key + same authenticated business/user + same operation + same payload
  returns the original successful JSON response;
- same key + same operation + different payload returns `409
IDEMPOTENCY_KEY_REUSED`;
- an original request that is still processing returns the successful response
  after it completes, or `409 IDEMPOTENCY_REQUEST_IN_PROGRESS` if it remains
  active too long;
- production rejects protected authenticated mutations without an idempotency
  key unless the route has a durable fallback key.

Protected routes include:

```http
POST /api/quotes
POST /api/quotes/:id/send
POST /api/quotes/:id/accept
POST /api/quotes/:id/decline
POST /api/quotes/:id/convert-to-job
POST /api/quotes/:id/duplicate
POST /api/public/quotes/:token/accept
POST /api/public/quotes/:token/decline
POST /api/invoices
POST /api/invoices/:id/send
POST /api/invoices/:id/payments
POST /api/invoices/:id/void
POST /api/appointments
PATCH /api/appointments/:id/reassign
POST /api/appointments/:id/confirm
POST /api/appointments/:id/start-travel
POST /api/appointments/:id/arrive
POST /api/appointments/:id/start
POST /api/appointments/:id/pause
POST /api/appointments/:id/resume
POST /api/appointments/:id/complete
POST /api/appointments/:id/cancel
POST /api/communications/manual
POST /api/ai/tori/actions/:draftId/confirm
```

Public quote accept/decline and Tori confirmation also use durable fallback
keys so customer double taps and repeated draft confirmations remain protected
even when a public or future channel client omits the header. Raw public tokens
and raw idempotency keys are never stored; only hashes are persisted.

## Current implemented endpoints

### Tori AI Workflow Assistant

Tori endpoints are authenticated and tenant-scoped. They derive `businessId`,
user id and role from the JWT and must never accept a client-supplied business
id.

```http
GET /api/ai/tori/summary
POST /api/ai/tori/chat
POST /api/ai/tori/actions/:draftId/confirm
```

`GET /api/ai/tori/summary` returns a compact operational snapshot:

- today's appointment count
- unassigned appointment count
- quotes awaiting customer response
- outstanding invoice cents
- overdue invoice cents
- provider status
- suggested prompts

`POST /api/ai/tori/chat` accepts:

```json
{
  "message": "Move Mia's appointment tomorrow to 4pm",
  "context": {
    "appointmentId": "optional-context-id"
  }
}
```

It returns a concise assistant message and, when appropriate, an `actionDraft`.
Draft creation must not mutate business data.

`POST /api/ai/tori/actions/:draftId/confirm` accepts the action draft originally
returned by Tori:

```json
{
  "draft": {
    "id": "draft-id",
    "type": "RESCHEDULE_APPOINTMENT",
    "requiresConfirmation": true
  }
}
```

Confirmation re-validates role, tenant, target entity and stale state before
calling existing workflow services. Appointment drafts include
`expectedUpdatedAt`; if the appointment changed after Tori prepared the draft,
the API returns `409 TORI_DRAFT_STALE`.

Initial supported action draft types:

- `RESCHEDULE_APPOINTMENT`
- `REASSIGN_TECHNICIAN`
- `CANCEL_APPOINTMENT`
- `CREATE_APPOINTMENT`
- `CREATE_QUOTE`
- `CREATE_INVOICE`
- `SEND_CUSTOMER_MESSAGE`

Tori never sends a customer message, quote or invoice without an explicit
confirm request.

### Customer communications

Customer communications are tenant-scoped records for appointment
confirmations/reminders, quote follow-ups, invoice reminders, payment
confirmations and manual office messages. Phase 1 uses a local-safe provider:
records are persisted and intended deliveries are logged, but no real SMS/email
vendor is connected.

```http
GET /api/communications
GET /api/communications/:id
POST /api/communications/manual
POST /api/communications/process-due
GET /api/communications/settings
PATCH /api/communications/settings
GET /api/communications/customers/:customerId/preferences
PATCH /api/communications/customers/:customerId/preferences
```

Supported `GET /api/communications` filters include `customerId`,
`appointmentId`, `quoteId`, `invoiceId`, `status`, `type` and `pageSize`.
Every query is scoped by the authenticated user's `businessId`.

`POST /api/communications/process-due` is the local/manual scheduler seam for
development and operations. Production scheduling should call the same service
from a server-side cron/worker; it must not depend on the mobile app being open.
Expected communication errors use structured codes such as
`COMMUNICATION_RECIPIENT_MISSING`, `COMMUNICATION_EMAIL_DISABLED`,
`COMMUNICATION_SMS_DISABLED`, `COMMUNICATION_ACCESS_DENIED` and
`COMMUNICATION_SEND_FAILED`.

### Business timezone rule

Every API stores appointment, job, invoice, notification and audit timestamps as
UTC instants. Business-day calculations must use the authenticated business
workspace timezone, defaulting to `Australia/Melbourne` when a workspace does
not have a valid IANA timezone.

Current Australian timezone examples include:

- `Australia/Sydney`
- `Australia/Melbourne`
- `Australia/Brisbane`
- `Australia/Adelaide`
- `Australia/Perth`
- `Australia/Hobart`

Clients must format displayed dates and times through the shared datetime
utilities in `packages/shared`. API date range filters remain UTC ISO strings,
but ranges for Dashboard, Calendar, Dispatcher, My Day, Jobs and Tori scheduling
must be derived from the business timezone before querying UTC fields.

### Media & documents

Media assets are scoped by `businessId` and are attached to a customer, job or
appointment. API responses never expose raw storage object keys.

```http
POST /api/media/upload-target
POST /api/media/:id/local-upload
POST /api/media/:id/complete
POST /api/media/:id/cancel
GET /api/media
GET /api/media/:id
GET /api/media/:id/preview
GET /api/media/:id/download
GET /api/media/:id/file
PATCH /api/media/:id
POST /api/media/:id/archive
POST /api/media/:id/restore
```

Supported filters for `GET /api/media` include `customerId`, `jobId`,
`appointmentId`, `category`, `mediaType`, `uploadedBy`, `uploadStatus`,
`processingStatus`, `dateFrom`, `dateTo`, `search`, `page` and `pageSize`.
Default media lists exclude archived files. Manager roles can request
`archived=true` to review archived media.

`POST /api/media/:id/archive` is the safe removal operation. It sets
`archivedAt`, keeps metadata and the storage object, writes audit/timeline
events and hides the file from normal media lists. `POST /api/media/:id/restore`
clears `archivedAt` for permitted elevated roles. Structured archive errors
include `MEDIA_NOT_FOUND`, `MEDIA_ACCESS_DENIED`, `MEDIA_ALREADY_ARCHIVED`,
`MEDIA_ARCHIVE_WINDOW_EXPIRED` and `PROTECTED_MEDIA_REQUIRES_ADMIN`.

The current milestone supports images, PDFs and office/text documents. Video
and audio are schema-ready for future use but rejected at upload time.

Media upload, preview and download access responses return API-relative paths
such as `/media/:id/file`, not absolute browser URLs. Clients must join those
paths with the configured API base URL exactly once and include JWT
authentication when fetching protected file bytes.

### Quotes customer-facing Phase 2

Authenticated office quote APIs remain under `/api/quotes`.

```http
GET /api/quotes/:id/preview
GET /api/quotes/:id/pdf
POST /api/quotes/:id/send
POST /api/quotes/:id/revise
POST /api/quotes/:id/convert-to-job
```

`GET /api/quotes/:id/pdf` returns `application/pdf` bytes with a safe filename
such as `Quote-Q-2026-001007.pdf`.

Authenticated mobile clients open generated quote PDFs by downloading this
endpoint to local secure cache and launching the local file. Existing
`QuotePdfDocument` metadata is returned by `GET /api/quotes/:id`, so clients can
show a View PDF action without exposing storage paths or regenerating the file
unnecessarily.

`POST /api/quotes/:id/send` accepts:

```json
{
  "to": "customer@example.com",
  "subject": "Quote Q-2026-001007 from Demo Tradie Co",
  "message": "Please review your quote."
}
```

Sending freezes the customer-facing quote revision, stores a quote PDF document
through the storage provider, creates a hash-only public access token and sends
the secure link through the configured quote email provider. Local development
uses the console provider only; do not claim real email delivery unless a
production provider is configured.

Public customer quote APIs do not require JWT login:

```http
GET /api/public/quotes/:token
POST /api/public/quotes/:token/view
POST /api/public/quotes/:token/accept
POST /api/public/quotes/:token/decline
```

Public responses expose only customer-facing quote content. They must not expose
business ids, staff user ids, audit metadata, internal notes or storage keys.

Structured quote public errors include:

- `QUOTE_PUBLIC_TOKEN_INVALID`
- `QUOTE_PUBLIC_TOKEN_EXPIRED`
- `QUOTE_SUPERSEDED`
- `QUOTE_ALREADY_ACCEPTED`
- `QUOTE_ALREADY_DECLINED`
- `QUOTE_ALREADY_RELATED_TO_JOB`
- `QUOTE_EXPIRED`
- `QUOTE_EMAIL_REQUIRED`
- `QUOTE_SEND_FAILED`
- `QUOTE_ACCEPTANCE_NAME_REQUIRED`
- `QUOTE_ACCEPTANCE_CONFIRMATION_REQUIRED`

Mobile native camera, photo library and document uploads use the same endpoint
sequence. The app first validates selected file type/size locally, then creates
an upload target, uploads real files through binary `multipart/form-data` to
`local-upload` in development, and calls the cancel endpoint for removed or
user-cancelled pending uploads where possible. Real files must not be
Base64-encoded inside JSON because that inflates payload size and can hit normal
JSON body limits before the media endpoint handles the request.

### Quotes

Quotes are tenant-scoped commercial offers. Every quote, quote line item and
quote revision is scoped by authenticated `businessId`; clients must never send
or choose a business id.

```http
POST /api/quotes
GET /api/quotes
GET /api/quotes/:id
PATCH /api/quotes/:id
POST /api/quotes/:id/items
PATCH /api/quotes/:id/items/:itemId
DELETE /api/quotes/:id/items/:itemId
POST /api/quotes/:id/reorder-items
POST /api/quotes/:id/send
POST /api/quotes/:id/revise
POST /api/quotes/:id/accept
POST /api/quotes/:id/decline
POST /api/quotes/:id/cancel
POST /api/quotes/:id/convert-to-job
GET /api/quotes/:id/preview
GET /api/quotes/:id/pdf
POST /api/quotes/:id/duplicate
```

Quote responses expose directionally explicit job relationships:

```json
{
  "relatedJobId": "job_existing_123",
  "convertedJobId": null,
  "relatedJob": {
    "id": "job_existing_123",
    "jobNumber": "JOB-2026-000012",
    "title": "Laundry leak"
  },
  "convertedJob": null
}
```

`relatedJob` means the job already existed before the quote. `convertedJob`
means the quote was accepted and converted into that job. The legacy `job`
field remains for backward compatibility only.

`POST /api/quotes/:id/convert-to-job` rejects accepted quotes that already have
`relatedJobId` with `QUOTE_ALREADY_RELATED_TO_JOB` so an existing job does not
accidentally get duplicated.

Quote lifecycle:

```text
DRAFT -> SENT -> VIEWED -> ACCEPTED -> CONVERTED
                 └──────-> DECLINED
DRAFT/SENT/VIEWED -> CANCELLED
DRAFT/SENT/VIEWED -> EXPIRED
SENT/VIEWED -> DRAFT through revise, after snapshotting the sent version
```

Money rules:

- Currency is AUD.
- Stored totals use integer cents.
- GST defaults to 10% (`1000` basis points).
- Discounts and deposits use either fixed cents or percentage basis points.
- Mobile forms show fixed discounts/deposits as dollars and percentages as
  percentages, then convert them to the stored cents/basis-point units before
  sending the API payload.
- The API recalculates line totals, subtotal, discount, GST, total and deposit

### Invoices

Invoices are tenant-scoped financial documents. Every invoice, invoice line item,
invoice payment record, generated PDF and public access token is scoped by
authenticated `businessId`; clients must never send or trust `businessId` in
request payloads.

Protected staff APIs:

```text
GET /api/invoices
POST /api/invoices
GET /api/invoices/accounts-receivable
GET /api/invoices/draft
GET /api/invoices/:id
PATCH /api/invoices/:id
POST /api/invoices/:id/send
POST /api/invoices/:id/payments
GET /api/invoices/:id/payments/:paymentId/receipt
POST /api/invoices/:id/void
GET /api/invoices/:id/pdf
```

`GET /api/invoices/draft` is a read-only initializer for mobile invoice forms.
It accepts optional `customerId`, `customerSiteId`, `jobId` and
`sourceQuoteId`. When a job originated from an accepted or converted quote, the
draft is initialized from that source quote's commercial snapshot: line-item
descriptions, decimal quantities, units, unit prices, taxable flags, pricing
mode, GST rate and discount settings are copied into an editable invoice payload.
The endpoint validates every customer, job and quote through the authenticated
`businessId`; source quote/job/customer mismatches are rejected server-side.

Accounts Receivable returns real invoice/payment data, not cached dashboard
values. It accepts optional `search`, `customerId`, `status`, `dateFrom` and
`dateTo` filters. `status` may be `OUTSTANDING`, `OVERDUE`, `DUE_SOON` or
`PAID`. Totals are integer cents:

- outstanding and overdue totals are based on positive `balanceDueCents`;
- due-soon covers invoices due within the next seven business-local days;
- paid-this-month is summed from non-reversed `InvoicePayment.receivedAt` rows;
- all sections remain scoped to the authenticated `businessId`.

Payment receipts are generated on demand from the invoice/payment snapshot,
stored behind the storage provider and returned as `application/pdf`. Receipt
PDFs use the public receipt number, invoice number, customer and payment
details; they do not expose internal database IDs or storage object keys.

Public customer invoice APIs do not require JWT login:

```text
GET /api/public/invoices/:token
POST /api/public/invoices/:token/view
```

Invoice totals use integer cents and are recalculated by the API on every write.
`OVERDUE` is treated as a derived display state when a sent/viewed/part-paid
invoice has a past due date and a positive balance. The persisted status remains
the business lifecycle state to avoid a background scheduler requirement.

Local invoice sending uses the console email provider only. It records `sentAt`,
stores a generated PDF, creates a hash-only public token and logs audit events,
but does not claim real email delivery.

Structured invoice errors include:

- `INVOICE_NOT_FOUND`
- `INVOICE_ACCESS_DENIED`
- `INVOICE_INVALID_STATUS`
- `INVOICE_LINE_ITEM_INVALID`
- `INVOICE_DUE_DATE_INVALID`
- `INVOICE_PAYMENT_INVALID`
- `INVOICE_PAYMENT_EXCEEDS_BALANCE`
- `INVOICE_ALREADY_PAID`
- `INVOICE_VOID`
- `INVOICE_PDF_GENERATION_FAILED`
- `INVOICE_SEND_FAILED`
  server-side and rejects invalid line items.

Local send behaviour uses the console email/provider seam and logs a preview
URL. Production email delivery remains a provider seam and is not enabled by the
local console provider.

### Health

```http
GET /api/health
GET /api/ready
```

`GET /api/health` is public, rate-limit exempt liveness and verifies only that
the API process is alive.

`GET /api/ready` is public, rate-limit exempt readiness. It verifies
PostgreSQL connectivity through Prisma using a tiny `SELECT 1`.

Readiness responses:

- `200 { "status": "ready" }`
- `503 { "status": "not_ready" }`

Readiness does not run migrations and never returns raw database errors,
credentials, tenant data or provider configuration.

### Register

```http
POST /api/auth/register
```

Creates a business workspace and owner user.

Required user fields:

- firstName
- lastName
- email
- password

Required business fields:

- businessName
- tradeType
- gstRegistered

Optional business fields:

- abn
- phone
- businessEmail
- address
- suburb
- state
- postcode

### Login

```http
POST /api/auth/login
```

Returns a 12-hour JWT and user/business profile. JWTs include an internal
`authVersion` claim, and every authenticated request validates that claim
against the current user record and active business membership.

### Forgot password

```http
POST /api/auth/forgot-password
```

Public, auth-rate-limited endpoint. Accepts:

```json
{
  "email": "owner@example.com"
}
```

Always returns the same neutral response:

```json
{
  "message": "If an account exists, password reset instructions have been sent."
}
```

If a matching active account exists, the API creates a one-time reset token,
stores only its SHA-256 hash, and sends reset instructions through the
configured email provider. Unknown or inactive accounts do not receive email,
but the response stays identical.

### Reset password

```http
POST /api/auth/reset-password
```

Public, auth-rate-limited endpoint. Accepts:

```json
{
  "token": "raw-reset-token-from-email",
  "newPassword": "new-secure-password"
}
```

Valid reset tokens are single-use and expire according to
`PASSWORD_RESET_TOKEN_TTL_MINUTES` (default 60). Successful reset updates the
password hash, marks the token used, revokes other outstanding reset tokens for
that user and increments `User.authVersion` so previously issued JWTs stop
authorizing access.

Invalid, expired, reused or revoked tokens return a structured safe error and
never expose raw database/provider details.

### Current user

```http
GET /api/auth/me
```

Requires JWT. Returns logged-in user and business.

### Change password

```http
POST /api/auth/change-password
```

Requires JWT and auth-rate limiting. Accepts `currentPassword` and
`newPassword`. The current password must verify against the stored scrypt hash.
Successful changes increment `User.authVersion` and revoke outstanding password
reset tokens.

### Sign out all devices

```http
POST /api/auth/sign-out-all-devices
```

Requires JWT and auth-rate limiting. Increments `User.authVersion`, causing all
previously issued JWTs for that user to fail validation. Normal mobile logout
removes only the local SecureStore/localStorage token because TradieOS does not
yet maintain per-device server-side sessions.

### Demo token

```http
GET /api/auth/demo-token
```

Development-only helper. Must remain disabled in production.

### Dashboard summary

```http
GET /api/dashboard/summary
```

Requires JWT. Reads live database records scoped to the logged-in user’s business.

Dashboard job counts include today’s jobs, upcoming jobs, jobs completed today,
overdue jobs, and open jobs. Archived jobs are excluded from active dashboard
counts.

Dashboard appointment counts are summary-only and include today’s appointments,
the next appointment, late appointments, upcoming appointments today, upcoming
future appointments, completed appointments today, and the logged-in user’s open
appointments.

Dashboard dispatcher counts are summary-only and include technicians currently
working, available technicians, and unassigned appointments for today.

Dashboard invoice metrics are tenant-scoped and cents-based. Outstanding is the
sum of positive `balanceDueCents` for sent/viewed/partially-paid/overdue
invoices only; drafts, paid invoices and void invoices are excluded. Overdue
invoices are derived from `dueDate < business-local today`, positive balance
and an unpaid lifecycle status. Paid today is based on actual
`InvoicePayment.receivedAt` rows for the business-local day, not invoice totals
or the invoice `paidAt` timestamp.

Dashboard "today" and "late" calculations are based on the logged-in business
timezone, not the API server timezone.

### Team members

```http
GET /api/members
GET /api/members/:id
POST /api/members/invite
GET /api/members/invitations/:token
POST /api/members/invitations/:token/accept
POST /api/members/:id/resend-invite
POST /api/members/:id/cancel-invite
PATCH /api/members/:id/role
PATCH /api/members/:id/status
DELETE /api/members/:id
```

Requires JWT. All member records are scoped to the authenticated user's `businessId`.

Rules:

- Owners can invite, suspend, reactivate, remove, change roles, and view member activity.
- Admins can manage team members except owners and cannot create owners.
- Members cannot change their own role, status, or remove themselves.
- The API must not allow removing or suspending the last active owner.
- `GET /api/members` excludes cancelled invitations by default. Cancelled invite rows remain available in database/audit history but do not appear in normal Team lists or filters.
- Invite requests require email, first name, last name, and a granular role.
- Invite email addresses are trimmed and lowercased before duplicate checks.
- Invite endpoints generate a long random invite token, store only the hash, and dispatch the invitation through the configured `EmailProvider`.
- Development responses may include the invite URL for local testing. Production responses must not expose raw invite tokens or invite URLs.
- Invite tokens are stored as hashes only, expire after 7 days by default, and are single-use.
- Cancelling an invite sets `inviteCancelledAt`, clears the token hash, marks invite delivery state as cancelled, and writes an audit log without deleting the row.
- Re-inviting an email whose previous invite was cancelled reuses the cancelled membership row with a fresh token rather than creating a duplicate audit record.
- Invitation acceptance creates or links a user to the existing business member record and never creates a new business workspace.
- Cancelled, expired, accepted, or mismatched-email invitations cannot be accepted.
- Email delivery is behind an `EmailProvider` interface. The default local provider logs a safe development invite, and the Resend provider is used when `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, and `EMAIL_FROM_ADDRESS` are configured.

Team endpoints return structured domain errors:

```json
{
  "code": "INVITE_ALREADY_PENDING",
  "message": "An invitation is already pending for this email.",
  "details": {}
}
```

Current team error codes include `INVITE_ALREADY_PENDING`, `MEMBER_ALREADY_ACTIVE`, `MEMBER_SUSPENDED`, `LAST_OWNER_PROTECTED`, `CANNOT_CHANGE_OWN_ROLE`, `INSUFFICIENT_PERMISSION`, `INVITE_EXPIRED`, `INVITE_CANCELLED`, and `TOO_MANY_REQUESTS`.

### Customers

```http
GET /api/customers
GET /api/customers/:id
POST /api/customers
PATCH /api/customers/:id
POST /api/customers/:id/archive
POST /api/customers/:id/restore
GET /api/customers/:id/sites
POST /api/customers/:id/sites
PATCH /api/customers/:id/sites/:siteId
POST /api/customers/:id/sites/:siteId/archive
```

Requires JWT. Customer and customer-site records are always scoped to the authenticated user's `businessId`; clients must never supply `businessId`.

`GET /api/customers` supports:

- `page`
- `pageSize`
- `search`
- `customerType`
- `state`
- `suburb`
- `archived`
- `tag`
- `sortBy`
- `sortOrder`

Responses return `records`, `total`, `page`, `pageSize`, and `totalPages`.

Customer rules:

- Active customers are returned by default; archived customers require `archived=true`.
- Archive/restore is soft-delete only and preserves history for future jobs, quotes and invoices.
- At least one of phone or email is required.
- First name or company name is required.
- Australian states and 4-digit postcodes are validated.
- Email and phone are normalised for tenant-local duplicate detection.
- Possible duplicates return `POSSIBLE_DUPLICATE_CUSTOMER` with safe match metadata. Creation/update can continue only when the client explicitly sends `allowDuplicate=true`.
- Audit logs are written for create, update, archive, restore, customer-site create/update/archive, and duplicate-warning override.

Customer error codes include `CUSTOMER_NOT_FOUND`, `INVALID_CUSTOMER_DATA`, `POSSIBLE_DUPLICATE_CUSTOMER`, `CUSTOMER_ALREADY_ARCHIVED`, `CUSTOMER_NOT_ARCHIVED`, and `INSUFFICIENT_PERMISSION`.

### Jobs

```http
GET /api/jobs
GET /api/jobs/:id
POST /api/jobs
PATCH /api/jobs/:id
PATCH /api/jobs/:id/status
POST /api/jobs/:id/archive
POST /api/jobs/:id/restore
GET /api/jobs/today
GET /api/jobs/upcoming
GET /api/jobs/assigned
```

Requires JWT. Job records are always scoped by authenticated `businessId`.
Clients must never supply or override `businessId`.

`GET /api/jobs` supports:

- `page`
- `pageSize`
- `search`
- `status`
- `priority`
- `customerId`
- `assignedToUserId`
- `dateFrom`
- `dateTo`
- `filter`
- `archived`
- `sortBy`
- `sortOrder`

Supported filters:

- `today`
- `tomorrow`
- `upcoming`
- `completed`
- `cancelled`
- `high-priority`
- `my-jobs`
- `unassigned`

Job rules:

- Customer, scheduled start, address, status and priority are required.
- Job numbers are generated by the API per business, e.g. `JOB-2026-000001`.
- Job number year and relative filters such as `today`, `tomorrow` and
  `upcoming` use the business timezone while stored `scheduledStart` and
  `scheduledEnd` values remain UTC.
- Technicians can only broadly list/view jobs assigned to themselves.
- Owners, admins and office managers can create, update, archive and restore jobs.
- Schedulers can create, assign and reschedule jobs, but cannot archive jobs.
- Accountants and read-only users can view jobs only.
- Archive/restore is soft-delete only.
- Status changes write audit log activity such as `JOB_STARTED`, `JOB_COMPLETED`, `JOB_CANCELLED`, and `JOB_ON_HOLD`.

Job error codes include `JOB_NOT_FOUND`, `INVALID_JOB_DATA`, `CUSTOMER_NOT_FOUND`, `ASSIGNEE_NOT_FOUND`, and `INSUFFICIENT_PERMISSION`.

### Appointments

```http
GET /api/appointments
GET /api/appointments/dispatcher
GET /api/appointments/:id
GET /api/appointments/:id/reassignment-options
POST /api/appointments
PATCH /api/appointments/:id
PATCH /api/appointments/:id/reassign
POST /api/appointments/:id/start
POST /api/appointments/:id/arrive
POST /api/appointments/:id/complete
POST /api/appointments/:id/cancel
POST /api/appointments/recommend
POST /api/appointments/availability
```

Requires JWT. Appointments are always scoped by authenticated `businessId`.
Appointments represent when and who performs work for a job. One job can have
many appointments, such as inspection, installation, maintenance, return visit
or emergency visit.

Appointment rules:

- Appointment numbers are generated by the API per business, e.g. `APT-2026-000001`.
- Appointment number year, working-hour validation, availability checks,
  dispatcher ordering and recommendation logic use the business timezone while
  stored `scheduledStart` and `scheduledEnd` values remain UTC.
- Owners, admins, office managers and schedulers can create, assign and reschedule appointments.
- Technicians can only view and update status on appointments assigned to themselves.
- Accountants, sales and read-only users can view appointments only.
- Appointment status transitions write audit log timeline events.
- Reassignment is a dedicated assignment-only operation. `PATCH /api/appointments/:id/reassign` changes only `assignedUserId`, keeps the appointment time, job, customer, notes and location snapshot unchanged, and writes `APPOINTMENT_REASSIGNED` timeline/audit metadata.
- `GET /api/appointments/:id/reassignment-options` returns active Technician-role candidates, today's workload, upcoming appointments today, availability indicators and a scheduling recommendation for the appointment's existing time window. Owners, admins and office staff can manage scheduling, but they are not eligible field assignees unless their workspace member role is `TECHNICIAN`.
- Appointments store a visit-location snapshot (`addressLine1`, `suburb`, `state`, `postcode`, optional `customerSiteId` and access instructions) so navigation and history do not depend on later customer/site address edits.
- Appointment location source can be customer service site, customer default address, or a one-off manual appointment address.
- Manual appointment addresses can optionally be saved as a customer service site in the same appointment creation transaction.
- `GET /api/appointments` supports date range, status, assigned technician, unassigned, job, customer and search filters for calendar views.
- `GET /api/appointments/dispatcher` returns the Dispatcher View read model for a selected day: technician workload cards, current status, completed/upcoming counts, estimated booked time, travel placeholder, overtime warning, unassigned appointments and recommendations for unassigned work. Dispatcher is a scheduling-management surface and is limited to owners, admins, office managers and schedulers.
- `POST /api/appointments/availability` checks business working hours in the
  business timezone and technician overlaps before scheduling or rescheduling.
- Overlapping appointments and outside-working-hours appointments are blocked by default. Owners may intentionally override conflicts by sending `allowConflictOverride: true`.
- Appointment reassignment conflict overrides are limited to owners and admins. Office managers and schedulers can reassign only when the selected technician is available.
- `POST /api/appointments/recommend` uses non-AI scheduling logic based on
  business-local working hours, active Technician-role membership, active user
  accounts, appointment conflicts and lower same-day workload. Travel time,
  technician skills, per-technician working hours and route distance remain
  future scheduling inputs.

Appointment error codes include `APPOINTMENT_NOT_FOUND`, `INVALID_APPOINTMENT_DATA`, `JOB_NOT_FOUND`, `ASSIGNEE_NOT_FOUND`, `APPOINTMENT_CONFLICT`, and `INSUFFICIENT_PERMISSION`.

## API standards

### REST

Use REST endpoints grouped by domain:

```text
/api/customers
/api/jobs
/api/quotes
/api/invoices
/api/payments
/api/messages
/api/ai
/api/notifications
/api/dashboard
/api/members
```

### Versioning

Future public API versions should use one of:

```text
/api/v1/...
```

or explicit Nest versioning. Do not introduce versioning until needed.

### Validation

Use Nest validation pipes and DTO classes.

Rules:

- Validate request bodies.
- Whitelist accepted fields.
- Reject unknown unsafe fields.
- Do not accept `businessId` from request bodies for tenant scoping.

### Error handling

Use standard HTTP status codes:

- 400: invalid request
- 401: unauthenticated
- 403: authenticated but not allowed
- 404: not found within tenant scope
- 409: conflict
- 500: server error

Errors should be clear but should not leak sensitive data.

### Pagination

Future list endpoints should support pagination:

```text
limit
cursor
```

or:

```text
page
pageSize
```

Cursor pagination is preferred for large datasets.

### Filtering

Filters must remain tenant-scoped.

Example:

```text
GET /api/jobs?status=SCHEDULED
```

The API must still derive `businessId` from JWT.

### Authorization

Every protected route must use JWT auth.

Authorization should check:

- user is active
- user belongs to business
- user has an active `BusinessMember` record
- role has permission
- data belongs to business

### Business isolation

Never expose cross-business data.

Correct pattern:

```ts
where: {
  businessId: currentUser.businessId,
  id: recordId,
}
```

Incorrect pattern:

```ts
where: {
  id: recordId,
}
```

## Response contracts

Shared response contracts should live in `packages/shared` when used by both API and mobile.

## Technician field workflow endpoints

Appointments remain the field-work unit. Jobs describe the overall work; an
appointment describes one visit.

Implemented technician workflow endpoints:

- `GET /api/appointments/my-day` returns the authenticated user's assigned
  appointments for the current business day, scoped by `businessId` and the
  logged-in user ID.
- My Day uses the business timezone to select today's appointments, returns a
  single `nextAppointment`, and separates the rest into `laterToday` and
  `completedToday` so the same appointment is never shown in more than one My
  Day section.
- My Day summary counts are calculated from the authenticated user's assigned
  appointments only: `completedCount` counts `COMPLETED`, `remainingCount`
  counts active workflow statuses, and `urgentCount` counts active `URGENT`
  priority appointments only.
- `POST /api/appointments/:id/start-travel` moves `SCHEDULED` or `CONFIRMED`
  appointments to `ON_THE_WAY` and records `travelStartedAt`. The UI labels
  this state as travelling.
- `POST /api/appointments/:id/arrive` moves `ON_THE_WAY` appointments to
  `ARRIVED`, records `arrivedAt` and finalises travel minutes.
- `POST /api/appointments/:id/start` moves `ARRIVED` appointments to
  `IN_PROGRESS`, records the first work-start timestamp and starts the active
  work timer.
- `POST /api/appointments/:id/pause` moves `IN_PROGRESS` appointments to
  `PAUSED` and accumulates work minutes without closing the appointment.
- `POST /api/appointments/:id/resume` moves `PAUSED` appointments back to
  `IN_PROGRESS` and accumulates paused minutes.
- `PATCH /api/appointments/:id/work-log` saves internal technician notes, work
  completed notes and follow-up flags during active field-work states.
- `POST /api/appointments/:id/signature` saves a tenant-scoped customer
  signature record for the appointment.
- `POST /api/appointments/:id/signature/skip` is limited to Owner/Admin and
  requires a reason for audit history.
- `POST /api/appointments/:id/complete` requires `workCompleted` and either a
  saved customer signature or an Owner/Admin signature-skip reason, saves the
  work log, finalises execution duration totals and moves `IN_PROGRESS`
  appointments to `COMPLETED`.

The API validates transitions again even when the mobile UI hides unavailable
actions. Invalid transitions return structured errors such as
`INVALID_STATUS_TRANSITION`, `WORK_COMPLETED_REQUIRED` or `SIGNATURE_REQUIRED`.

## AI endpoint rule

AI endpoints must produce drafts, recommendations, or summaries by default. Any endpoint that sends, executes, confirms, or modifies important data must require explicit user confirmation.
