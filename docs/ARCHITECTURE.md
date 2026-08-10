# Architecture

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
- `S3CompatibleStorageProvider` is the production adapter seam for AWS S3,
  Cloudflare R2, MinIO or compatible object stores.

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
  customer, job or appointment and converted into a job after acceptance.
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
- Sending a quote freezes the current customer-facing `QuoteRevision`, stores a
  tenant-scoped `QuotePdfDocument`, creates a hash-only
  `QuotePublicAccessToken`, and then sends the secure public quote URL.
- Public customer routes are separate from authenticated staff APIs under
  `/api/public/quotes/:token`. They resolve only hash-matched, unexpired,
  non-revoked tokens and return a frozen customer-facing quote snapshot without
  internal notes, tenant ids, staff ids, audit metadata or storage keys.
- Customer acceptance/decline records immutable metadata against the quote,
  token and audit log. Accepted/declined links remain readable so customers can
  see the final state, but cannot be used for another mutation.

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
- Appointment recommendation is deliberately non-AI for now. It checks working hours, active technicians and existing appointment conflicts, then returns a recommendation with a human-readable reason.
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
