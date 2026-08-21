# Architecture

## Tori AI workflow assistant

Tori is implemented as a server-side workflow assistant in `AiModule`. The
mobile app talks only to TradieOS API endpoints and never sends provider keys or
raw business datasets to an external AI vendor.

```text
apps/mobile Tori tab
  -> /api/ai/tori/*
  -> AiService
  -> AiProvider seam + targeted tenant-scoped read tools
  -> existing Appointments / Quotes / Invoices / Communications services
```

Phase 1 uses deterministic local-safe behaviour through the provider seam. A
real LLM provider can be added behind `AiProvider`, but business totals, date
handling, permissions, stale checks and mutations must remain deterministic and
server-side.

Tori follows the product safety pattern:

```text
READ -> UNDERSTAND -> PROPOSE -> CONFIRM -> EXECUTE
```

Read tools fetch compact summaries only: appointments, technician schedules,
unassigned work, outstanding invoices, overdue invoices, quote follow-ups and
jobs in progress. Action Drafts are structured payloads returned to the mobile
UI; confirmation must call `POST /api/ai/tori/actions/:draftId/confirm`.

Confirmed actions reuse existing domain services instead of duplicating
business logic. Reschedule/reassign/cancel use `AppointmentsService`, quote
draft creation uses `QuotesService`, invoice draft creation uses
`InvoicesService`, and message drafts use `CustomerCommunicationsService`.
Tori action confirmation is protected by durable idempotency. The API uses the
confirmed draft id as a fallback idempotency key and still honours a supplied
`Idempotency-Key` header. Re-confirming the same draft/operation/payload after
an API restart returns the original successful response instead of executing the
mutation again.

Appointment action drafts include the target appointment `updatedAt` timestamp.
Confirmation reloads the appointment and rejects stale drafts before mutation.
Confirmation responses also update structured Tori context with active/recent
entity references. Follow-up workflows must use this context for references such
as “this customer”, “her”, “it” or “the newly created customer” instead of
parsing arbitrary prior chat text.

Compound dispatch workflows use the same architecture. `AiService` stores
multi-step customer/job/appointment orchestration in structured
`pendingDispatch` context and resumes it across separate chat requests. Each
step still produces a normal Action Draft and confirmation still delegates to
the existing customer, job and appointment services. The dispatch orchestrator
does not duplicate the appointment conflict engine; it asks the existing
availability service for candidate technician slots before drafting an
appointment.

Tori routing starts with a structured current-turn interpretation layer. The
parser extracts intents and entities from the latest user message before any
pending workflow or recent context is considered. Explicit current-turn
customer, job/issue, address and scheduling entities override stale recent
context; pending/recent context is used only when the current turn is implicit
or ambiguous. This parser feeds `pendingDispatch` and existing appointment/job
workflows, and is designed to be reusable by future voice input without moving
business mutations out of the confirmed Action Draft path.

Tori dispatch planning now separates current-turn understanding from tenant
entity resolution. Customer names are resolved against tenant customers before
safe context is applied. Service location resolution prefers explicit current
addresses, then customer service sites/defaults, then same-customer historical
job addresses with confirmation or choice prompts. Confirmed Tori dispatch jobs
reuse `CustomersService.createSite()` to persist new customer service locations
without duplicating existing sites, keeping customer profiles useful for future
appointments.

Tori conversational state is explicit and typed. The API returns structured
`ToriContext` containing active workflow metadata, `pendingDispatch` slots and
`pendingQuestion` prompts. The planner routes each turn in this order: strong
new root command, structured pending-question answer, expected slot answer,
read-only interruption, contextual continuation, generic intent detection, then
unsupported response. This prevents short replies such as "Yes", "60 mins" or
"the second one" from being reinterpreted as unrelated generic commands, while
still allowing a strong new request such as "Create customer David" to clear an
incompatible appointment workflow. Strong mutating root commands also protect
quote, invoice, customer, job and appointment workflows from stale pending
slots; for example, "Create invoice" must start invoice drafting rather than be
parsed as quote line-item text from an old `QUOTE_LINE_ITEMS` prompt. Read-only
interruptions preserve pending workflow context so the user can resume after
the answer. The mobile Tori screen must store the latest context from every
chat and confirmation response and send that serialized context with the next
request. Confirmation responses for completed quote and invoice drafts must
replace active pending context with completed workflow metadata.

Expected-slot consumption is centralised in the server workflow layer rather
than owned by mobile, SMS, voice or another channel. When `pendingQuestion`
states that dispatch is waiting for a job description, contact detail, service
address, appointment date/time, duration or selection, the next compatible user
reply is parsed as that slot and merged into the same `pendingDispatch`
workflow. The planner then immediately resumes from the next unresolved
requirement and continues to use existing domain services for confirmed
customer, job and appointment mutations.

## Customer communications and reminders

Customer communications are implemented as a reusable domain owned by
`CustomerCommunicationsModule`, not as ad hoc send logic inside appointments,
quotes or invoices. Appointment, quote and invoice services call this module at
their lifecycle boundaries; the module owns templates, channel selection,
preferences, scheduling, idempotency and provider delivery.

`CustomerCommunicationProvider` routes EMAIL and SMS through configured channel
providers:

- Local development uses safe local providers that log recipient, type, subject,
  safe preview and entity reference without logging public-token hashes, auth
  headers, storage keys or internal audit metadata.
- Production customer email uses Resend.
- Production customer SMS uses Twilio, normalising Australian mobile numbers to
  E.164 format before delivery.

Provider success records `provider`, `providerMessageId`, `sentAt` and `SENT`.
Provider failure records `provider`, `failedAt`, `failureReason` and `FAILED`.
Failed provider calls are not silently marked as sent.

Scheduled reminders are persisted with `scheduledFor` as absolute UTC
timestamps and processed by `processDueCustomerCommunications()`. The production
API registers `CustomerCommunicationWorker`, disabled by default and enabled
with `CUSTOMER_COMMUNICATION_WORKER_ENABLED=true`. The worker runs on a bounded
interval, defaults to every 5 minutes, and uses bounded batches.

Horizontal safety is database-backed. Due records are atomically claimed by
moving `SCHEDULED` to `PROCESSING` with `processingStartedAt` and
`processingExpiresAt`; a second API replica or cron invocation cannot claim the
same row once the first claim succeeds. Stale `PROCESSING` rows can be reclaimed
after the processing lock expires. Before delivery, the service rechecks domain
eligibility so cancelled appointments, accepted quotes and paid invoices do not
send stale reminders. Provider success records `SENT`; provider failure records
`FAILED` and the worker continues the batch.

Inbound SMS -> Tori is intentionally not implemented yet. Twilio was selected
for outbound SMS so a future inbound webhook can plug into the existing
conversation engine without replacing the transport provider.

Communication settings are business-scoped. Customer preferences are
customer-scoped. API guards remain authoritative: UI hiding is convenience only.

## API rate limiting and abuse protection

TradieOS uses a global Nest guard for production API abuse protection. The
guard runs after JWT authentication, so authenticated requests are bucketed by
`businessId` and user id; public requests are bucketed by source IP and policy.
Auth routes also include a hashed email/account hint when present so login
brute-force attempts are limited without revealing whether the account exists.

Rate-limit policies are metadata-driven:

- `global` for ordinary authenticated API traffic.
- `auth` for login, registration, demo-token and invitation acceptance flows.
- `publicRead` for public invitation, quote and invoice preview routes.
- `publicMutation` for customer-facing public quote/invoice mutations and
  manual communication sends.
- `toriChat` for Tori summary/chat traffic.
- `toriAction` for Tori action confirmation.
- `media` for authenticated media upload, preview and download APIs.
- `internal` for authorised manual processor endpoints such as
  communications `process-due`.

The limiter returns HTTP `429` with `RATE_LIMIT_EXCEEDED`, a friendly message
and a `Retry-After` header. Safe logs include the policy, route pattern and a
short identity hash only; raw JWTs, public tokens, passwords, Tori messages and
provider secrets must never be logged.

Client IP handling is conservative. Direct clients use the socket remote
address and arbitrary `X-Forwarded-For` headers are ignored. Deployments behind
a trusted reverse proxy or load balancer must explicitly set `TRUST_PROXY=true`,
which enables a single trusted proxy hop in Express and allows the limiter to
use the forwarded client IP.

The first beta implementation stores buckets in process memory. This is
adequate only for an intentionally single-instance API deployment. Multiple API
replicas would each have independent counters, so a shared limiter store such
as Redis or a managed gateway limit should be added before horizontal API scale.

## Idempotency and double-submit protection

High-risk mutations are protected by `IdempotencyModule`. Controllers stay thin:
they derive the authenticated `businessId`/user id or a hash-only public scope,
name the operation, pass the request payload and delegate the actual mutation to
the existing domain service.

```text
Mobile/Public/Tori client
  -> Idempotency-Key header or durable route fallback
  -> IdempotencyService claim/replay/conflict check
  -> existing Quotes / Invoices / Appointments / Communications / Tori service
```

The `IdempotencyRecord` table stores:

- hashed key
- operation name
- authenticated business/user scope or hashed public scope
- request hash
- status (`IN_PROGRESS`, `SUCCESS`, `FAILED`)
- cached successful JSON response
- completion and expiry timestamps

Same key + same scope + same operation + same request returns the original
successful response. Same key + different request returns
`IDEMPOTENCY_KEY_REUSED`. Concurrent duplicates rely on the database unique
constraint to claim one executor; other callers wait briefly and replay the
successful result when the first request completes.

Public customer routes never store raw public tokens as idempotency scope.
Public quote accept/decline uses a hashed public scope and fallback action key
so customer double taps are protected even when the public client does not send
its own header. Manual communications and financial mutations should always
reuse one stable client key for retries to avoid duplicate provider sends,
payments, invoices or quotes.

## Media & document management

The media module extends the existing multi-tenant API rather than introducing a
separate file service. `MediaModule` owns upload-target creation, local
development uploads, metadata, archive/restore and authorised preview/download
URLs.

Safe removal uses the existing archive/restore architecture. Archiving sets
`archivedAt`, keeps the storage object, preserves metadata, writes
`MEDIA_ARCHIVED` audit/timeline entries and relies on default list filtering to
hide files from active views. Restoring clears `archivedAt` and writes
`MEDIA_RESTORED`. Permanent purge is intentionally future-only and must include
Owner/Admin authority, a retention period and compliance/legal hold checks.

Storage is abstracted behind `StorageProvider`:

- `LocalDevelopmentStorageProvider` writes files to `STORAGE_LOCAL_PATH` and
  serves them through authenticated API routes.
- `S3CompatibleStorageProvider` stores private objects in AWS S3, Cloudflare
  R2, MinIO or compatible object stores and returns short-lived signed URLs for
  upload, preview and download operations.

Object keys are tenant-prefixed and entity-scoped, for example
`businesses/{businessId}/appointments/{appointmentId}/image/...`,
`businesses/{businessId}/quotes/{quoteId}/pdf/...` and
`businesses/{businessId}/invoices/{invoiceId}/pdf/...`. Buckets must remain
private; customer quote/invoice access continues to be controlled by secure
public tokens and API/domain checks, not by making the bucket public.

Mobile screens consume the API through shared types and role-aware navigation:
Job Details, Appointment Details, Customer Details and My Day can show or add
media according to the existing role/permission model.

The mobile evidence capture flow uses Expo-compatible native pickers inside the
existing Media API pipeline:

1. `expo-image-picker` captures camera photos or selects photo-library images.
2. `expo-document-picker` selects PDFs, Word, Excel or text files copied to the
   app cache.
3. The user reviews selected files, categories, caption, notes and visibility.
4. The app creates a tenant-scoped upload target with `POST /api/media/upload-target`.
5. Local development uploads real device files as binary `multipart/form-data`
   through `POST /api/media/:id/local-upload`, which completes the existing
   `MediaAsset`. The tiny development-only demo upload may still use JSON
   Base64, but camera, library and document files must not.
6. Failed or cancelled pending uploads call `POST /api/media/:id/cancel` where
   possible, then refresh through the normal media list APIs.

Temporary cache files may be deleted after success or cancellation. Original
device photos are never deleted.

## Overview

TradieOS is a TypeScript monorepo with a mobile frontend, API backend, shared types, and PostgreSQL database. The architecture is designed for a multi-tenant SaaS product where every business workspace is isolated.

## Repository structure

```text
apps/
  api/       NestJS API, Prisma, PostgreSQL access
  mobile/    Expo React Native app
packages/
  shared/    Shared TypeScript contracts
docs/        Product and engineering documentation
```

## Frontend

Technology:

- Expo React Native
- TypeScript
- React Navigation
- Expo SecureStore

Responsibilities:

- Login/register screens.
- Secure token storage.
- Mobile-first user experience.
- Authenticated API calls.
- Dashboard display.
- Placeholder module navigation.

Current screens:

- Login
- Register
- Accept Invitation
- Dashboard
- Calendar
- Dispatcher View
- Appointment Details
- Appointment Form
- Appointment Reassign
- Tori Chat
- Customers
- Customer Details
- Customer Form
- Jobs
- Job Details
- Job Form
- Quotes
- Invoices
- Notifications
- Settings
- More
- Team
- Team Member Profile

Appointment creation navigation:

- `AppointmentForm` is the single canonical mobile route for creating appointments.
- Calendar FAB, Dispatcher FAB, Job Details `Schedule Appointment`, and the job-created `Schedule Now` prompt must all open `AppointmentForm`.
- Supported prefill params are `customerId`, `customerSiteId`, `jobId`, `selectedDate`, and `technicianId`.
- Dispatcher opens the same route with the selected dispatcher date so users do not silently schedule against today's date while viewing another day.
- Do not add duplicate appointment creation routes unless the navigation architecture is intentionally migrated in one change.
- Global appointment creation entry points must not preselect the first customer from API results. `AppointmentForm` only preselects a customer, site, job, date or technician when that value is explicitly supplied by the navigation context and validated through the tenant-scoped API.

Quote architecture:

- `Quote` is the customer-facing commercial offer that can be created from a
  customer, related job or appointment and converted into a job after
  acceptance.
- Quote/job relationships are directional. `Quote.relatedJobId` means the job
  already existed when the quote was prepared. `Quote.convertedJobId` means the
  accepted quote created that job. `Job.sourceQuoteId` is the structured source
  of truth for jobs created from accepted quotes. Legacy `Quote.jobId` remains
  only as a compatibility field during migration and must not drive new UX.
- Accepted quotes with `relatedJobId` must not create duplicate jobs through
  conversion. The API rejects those conversion attempts with
  `QUOTE_ALREADY_RELATED_TO_JOB`; the mobile UI shows View Related Job instead.
- Quote lifecycle rules are centralised in `packages/shared/src/quotes.ts` and
  revalidated by the API. Drafts are editable, sent/viewed quotes require a
  revision flow, accepted quotes are immutable except conversion, and terminal
  statuses cannot be edited normally.
- Quote totals are calculated with integer cents in the shared calculation
  helper and recalculated server-side on every write. The mobile preview uses
  the same helper for instant feedback, but the API remains authoritative.
- `QuoteRevision` stores immutable snapshots before customer-facing send,
  acceptance and revision operations so accepted/sent versions are not silently
  overwritten.
- Local quote send uses a quote email-provider seam. Development sends through
  the console provider and logs the recipient, subject, PDF filename and secure
  quote link. Production delivery remains provider-based and must not bypass
  Tori/TradieOS confirmation rules.
- Quote PDF generation is server-side through `QuotePdfProvider`. The current
  deterministic provider returns real `application/pdf` bytes and stores them
  through the existing storage abstraction so raw storage paths are never
  exposed to clients.
- Authenticated mobile clients view generated quote PDFs by downloading the
  protected PDF endpoint to local cache before opening the local file. The PDF
  endpoint remains private and is not made public for convenience.
- Sending a quote freezes the current customer-facing `QuoteRevision`, stores a
  tenant-scoped `QuotePdfDocument`, creates a hash-only
  `QuotePublicAccessToken`, and then sends the secure public quote URL.
- Public customer routes are separate from authenticated staff APIs under
  `/api/public/quotes/:token`. They resolve only hash-matched, unexpired,
  non-revoked tokens and return a frozen customer-facing quote snapshot without
  internal notes, tenant ids, staff ids, audit metadata or storage keys.

Invoice architecture:

- `Invoice` is the customer-facing billable financial document. It links to a
  `Customer`, optional `CustomerSite`, optional source `Job`, and optional
  `sourceQuoteId` when the job originated from an accepted quote.
- Invoice/job/quote relationships are explicit: `Invoice.jobId` identifies the
  source job being billed, while `Invoice.sourceQuoteId` preserves accepted
  quote context when useful. A job may have multiple invoices.
- Invoice lifecycle rules are centralised in `packages/shared/src/invoices.ts`.
  Drafts are editable, sent/viewed/part-paid invoices accept controlled send,
  payment and void actions, paid invoices are immutable, and void invoices cannot
  receive payments.
- Invoice totals are calculated with integer cents in shared helpers and
  recalculated server-side on every write. The mobile form uses the same helpers
  for preview only; the API remains authoritative.
- Invoice draft initialization is API-driven. `GET /api/invoices/draft` prefers
  the accepted/converted `Job.sourceQuoteId` commercial snapshot, then falls
  back to existing job/default invoice entry behavior for jobs without quotes.
  Source quote line items are copied into the invoice draft as an editable
  snapshot; later invoice edits must not mutate the accepted quote.
- `OVERDUE` is a derived display state based on due date and positive balance,
  not a scheduled background mutation.
- Local invoice send uses an invoice email-provider seam. Development sends
  through the console provider and logs recipient, subject, PDF filename and
  secure invoice link. Production delivery remains provider-based.
- Invoice PDF generation is server-side through `InvoicePdfProvider` and stored
  via the existing storage provider. Authenticated clients download PDFs through
  the protected API before opening them.
- Accounts Receivable is an invoice read model, not a separate ledger. The API
  derives outstanding, overdue, due-soon and paid-this-month summaries from
  tenant-scoped invoices and non-reversed payment rows using integer cents.
- Payment receipts are generated on demand by the same PDF provider seam,
  stored in `InvoiceReceiptDocument`, and linked to the originating
  `InvoicePayment`. Receipt numbering is business-local through
  `ReceiptSequence`.
- Public customer routes live under `/api/public/invoices/:token` and resolve
  hash-only, unexpired, non-revoked tokens. Public responses expose only
  customer-safe invoice data and never internal notes, tenant ids, audit metadata
  or storage paths.
- Customer acceptance/decline records immutable metadata against the quote,
  token and audit log. Accepted/declined links remain readable so customers can
  see the final state, but cannot be used for another mutation.

Core business lifecycle:

- The release-ready happy path is Customer -> Job or Quote -> Quote Send ->
  Public Quote View -> Accept -> Job -> Appointment -> Confirm -> Start Travel
  -> Arrive -> Start Work -> Pause/Resume -> Complete Appointment -> Job
  Progression -> Invoice -> Send Invoice -> Public Invoice View -> Partial
  Payment -> Full Payment -> Receipt -> Accounts Receivable/Dashboard.
- Quote, appointment and invoice status/action decisions must come from shared
  domain helpers and then be revalidated by API services. Mobile screens should
  hide impossible actions instead of showing buttons that predictably produce
  403 or invalid-transition responses.
- Financial values are canonical in integer cents. Forms may hold temporary
  string input while editing, but saved quotes, invoices, payments, PDFs, public
  views, receipts, job/customer summaries, Accounts Receivable and Dashboard
  must all render API-calculated totals.
- Mutation screens should refresh their current record after successful writes
  and on focus where stale data is likely. Duplicate taps must be blocked in the
  UI, high-risk client calls must send a stable `Idempotency-Key`, and backend
  services remain the source of truth for idempotent or rejected repeated
  transitions.

Dispatcher navigation:

- Dispatcher remains a top tab inside Calendar, not a separate bottom tab.
- Dispatcher uses one primary vertical list container for the whole board. Horizontal filter chips live inside the list header to avoid nested vertical scroll/gesture conflicts.
- Calendar day/week/month/agenda swipe behaviour must not wrap Dispatcher content.

## Backend

Technology:

- NestJS
- TypeScript
- Prisma
- JWT authentication

Responsibilities:

- Authentication.
- Business workspace registration.
- Tenant isolation.
- Role enforcement.
- Database-backed dashboard.
- Future module APIs.

Current modules:

- auth
- businesses
- members
- customers
- jobs
- appointments
- quotes
- invoices
- payments
- messages
- ai
- notifications
- dashboard
- documents
- reports
- integrations

## Database

Technology:

- PostgreSQL
- Prisma

Database rules:

- Every tenant-owned entity must include `businessId` or be reachable only through a business-scoped parent.
- Cross-tenant relations must be prevented with compound relations where practical.
- Queries must filter by authenticated `businessId`.
- Business workspaces store an IANA `timezone` such as `Australia/Melbourne`, `Australia/Sydney`, `Australia/Brisbane`, `Australia/Adelaide`, `Australia/Perth`, `Australia/Hobart`, or `Australia/Darwin`.
- New business workspaces default to `Australia/Melbourne`.
- Appointment, job, invoice, notification and audit timestamps are stored as
  UTC instants. Dashboard, Calendar, Dispatcher, My Day, Job filters and Tori
  scheduling ranges are calculated from the business timezone before querying
  UTC timestamps.
- Date/time display must use the shared datetime utilities in
  `packages/shared/src/datetime.ts`. UI code must not format business
  appointment times with device-local or server-local assumptions.

## Authentication

Current authentication:

- JWT access tokens.
- Password hashing with Node crypto `scrypt`.
- Mobile token storage with Expo SecureStore.
- Web fallback using localStorage for development/browser support.

Authentication flow:

1. User registers or logs in.
2. API validates credentials.
3. API returns JWT and user/business profile.
4. Mobile stores token.
5. API calls include `Authorization: Bearer <token>`.
6. API derives `userId` and `businessId` from JWT.

Invitation acceptance flow:

1. An owner/admin invites a team member from the existing business workspace.
2. The API creates a long random invite token, stores only its hash, and sends the invitation through the configured `EmailProvider`.
3. The invited user opens `/invite/:token`.
4. The app previews the invite state and shows only the existing business name, invited email, and assigned role.
5. The user sets their name and password without creating a new business.
6. The API transaction creates or links the user, activates the existing `BusinessMember`, invalidates the token, logs audit events, and returns a JWT.
7. The app stores the JWT and opens the invited user's workspace dashboard.

Team invitation email architecture:

- `EmailProvider` is the API boundary for invitation, resend, and welcome emails.
- Local and unconfigured environments use `ConsoleEmailProvider` so invitation creation still succeeds during development.
- Production can use `ResendEmailProvider` by setting `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, and `EMAIL_FROM_ADDRESS`.
- Raw invite URLs are exposed to the mobile UI only outside `NODE_ENV=production`; production delivery happens through email provider payloads and audit metadata.

Team management UI flow:

- Invite creation validates email, first name, last name, and selected role before calling the API.
- Duplicate invite/member responses use structured API error codes so the UI can show pending invite, active member, or suspended member guidance.
- Duplicate invite checks run in the mobile form before submit and again in the API after trimming/lowercasing the email address.
- Member actions use anchored overlay menus, global toast feedback, loading indicators, and confirmation modals so cards do not resize or shift while managing roles, status, deletion, or invite cancellation.
- Team data uses one screen-level members state plus a central refresh path. Successful mutations update local state immediately, then await a `GET /api/members` refresh before clearing the blocking loading overlay.
- Cancelled invites are removed from local state immediately and are excluded by the API from normal Team list responses.
- The latest development invite URL is stored against the related member id, is shown only outside production, updates on resend, and clears when the invite is cancelled or no longer pending.
- Team profile reads `GET /api/members/:id` and displays tenant-scoped member details plus recent audit activity.

Customer management architecture:

- `Customer` is the customer profile record for people, households, companies, real estate contacts, builders and other recurring clients.
- `CustomerSite` stores one or more service locations for a customer and is compound-scoped through `customerId + businessId`.
- Customer APIs always derive `businessId` from the authenticated request context and return 404 for records outside the tenant.
- Customer archive/restore is soft-delete only; archived customers are hidden from active lists by default.
- Duplicate detection is tenant-local and uses `emailNormalised` and `phoneNormalised`. The API returns a structured `POSSIBLE_DUPLICATE_CUSTOMER` warning instead of silently blocking every duplicate.
- Customer UI follows the Team module state approach: update local state where safe, await API refresh, preserve filters/search, show top safe-area toasts, and use centred loading overlays for blocking saves.
- The customer details screen includes future-ready empty sections for jobs, quotes, invoices, documents and activity without fabricating data.

Job management architecture:

- `Job` is the central service-work record that future quotes, invoices, photos, documents, calendar events, reports and Tori summaries will connect to.
- Jobs are tenant-scoped by `businessId` and linked to customers through compound customer/business relations.
- Job numbers are API-generated from a per-business `JobSequence` record.
- Job archive/restore is soft-delete only; archived jobs are excluded from active lists and dashboard counts by default.
- Job status transitions store operational timestamps where appropriate, such as `actualStart`, `actualEnd`, and `completedAt`.
- Job audit logs record creation, assignment, updates, starts, completion, cancellation and hold events.
- Mobile jobs follow the customer/team UX pattern with pull-to-refresh, filters, large quick actions, future-ready sections, and tenant-scoped API refreshes.

Appointment and scheduling architecture:

- `Job` represents the work request and business context.
- `Appointment` represents when the work happens and who performs it.
- One job can have many appointments for inspections, installations, maintenance, return visits and emergency visits.
- Calendar, Tori scheduling, notifications and future travel planning should use appointments instead of job schedule fields.
- Appointment recommendation is deliberately non-AI for now. It checks business working hours, active `TECHNICIAN` role members with active user accounts, existing appointment conflicts and same-day workload, then returns a recommendation with a human-readable reason. Owners/admins manage scheduling but are not considered assignable field technicians by default.
- Calendar is a mobile tab over appointment APIs. It supports day, week, month
  and agenda ranges, technician/status/search filters, jump-to-date, swipe date
  movement and appointment detail drill-in. Calendar ranges and grouping are
  business-timezone based.
- Dispatcher View is an operational read model over the same appointment APIs.
  It groups today's appointments by technician using the business timezone,
  derives status from appointment state/time, shows workload and unassigned
  work, exposes move/reassign hooks for future drag-and-drop, and keeps
  assignment changes on the existing reassignment endpoint.
- Appointment availability checks are exposed as API architecture for Tori prompts such as “show today’s appointments”, “who is available tomorrow?”, “move John’s appointment”, and “schedule this job”. Tori must still draft or recommend changes before user confirmation.
- Appointment reassignment is a dedicated command path, not a full appointment edit. It updates only `assignedUserId`, keeps the appointment's job, customer, time, notes and location snapshot intact, checks technician availability for the existing time window, writes `APPOINTMENT_REASSIGNED` audit/timeline metadata and calls notification-service stubs for future push/SMS/email delivery.
- Reassignment options use the existing scheduling recommendation service plus workload/availability data so future Tori scheduling commands can reuse the same API without redesign.
- Appointment notification events are represented as audit/loggable domain actions for created, updated, reassigned, rescheduled, cancelled and completed appointments. Push/SMS/email delivery remains future work.
- Appointment status changes create audit log entries that are shown in the job timeline.
- Existing job schedule fields remain for compatibility while appointments become the future scheduling source.

Technician field workflow architecture:

- `GET /appointments/my-day` is the mobile-first field read model for
  technicians and solo owners. It returns only appointments assigned to the
  logged-in user for the current business day in the business timezone.
- Status transition rules are centralised in shared code and revalidated by the
  API before writes. The active path is `SCHEDULED/CONFIRMED -> ON_THE_WAY
(travelling) -> ARRIVED -> IN_PROGRESS -> PAUSED -> IN_PROGRESS ->
COMPLETED`.
- `AppointmentWorkLog` stores technician notes, work completed and follow-up
  flags. Audit logs remain the timeline/event history.
- Appointment execution timing uses server-recorded UTC transition timestamps
  plus persisted travel, work and paused totals. Mobile screens display live
  timers from those server timestamps without writing to the API every second.
- `AppointmentSignature` stores customer sign-off as structured signature
  strokes or an Owner/Admin skip reason. Completion validates signature
  requirements server-side before closing the appointment.
- Completing an appointment does not automatically complete the job. A job may
  have multiple appointments, and job completion remains an explicit action.
- When field work starts, a non-cancelled/non-completed job may safely move to
  `IN_PROGRESS`.
- Offline support is intentionally future work; the current service boundaries
  keep status changes and work-log updates as queueable command operations.

## AI layer

Tori should be implemented as a dedicated AI service layer, not scattered across controllers.

Future structure:

```text
ai/
  ai.module.ts
  ai.service.ts
  prompts/
  tools/
  safety/
```

AI actions should be represented as drafts or recommendations before confirmation.

## Notifications

Notifications surface reminders, follow-ups, failed actions, unread customer updates, and Tori priorities.

Future notification channels:

- in-app
- push
- SMS
- email

## Future integrations

Integrations must be modular, tenant-scoped, and permission-aware.

Potential integrations:

- Stripe
- Twilio
- SendGrid
- Firebase Push
- Google Calendar
- Google Maps
- Xero
- MYOB
- QuickBooks

## Scalability principles

- Keep domain logic in services.
- Keep controllers thin.
- Keep AI actions auditable.
- Keep tenant access explicit.
- Keep shared contracts in `packages/shared`.
- Avoid cross-module shortcuts that bypass business scoping.
