# API

## Overview

TradieOS uses a REST API built with NestJS. API routes are prefixed with:

```text
/api
```

## Current implemented endpoints

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

The current milestone supports images, PDFs and office/text documents. Video
and audio are schema-ready for future use but rejected at upload time.

Media upload, preview and download access responses return API-relative paths
such as `/media/:id/file`, not absolute browser URLs. Clients must join those
paths with the configured API base URL exactly once and include JWT
authentication when fetching protected file bytes.

### Health

```http
GET /api/health
```

Returns service health.

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

Returns JWT and user/business profile.

### Current user

```http
GET /api/auth/me
```

Requires JWT. Returns logged-in user and business.

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
- `GET /api/appointments/:id/reassignment-options` returns active technician candidates, today's workload, upcoming appointments today, availability indicators and a scheduling recommendation for the appointment's existing time window.
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
  business-local working hours and appointment conflicts. Travel time is a
  placeholder for future route planning.

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
  appointments to `ON_THE_WAY`.
- `POST /api/appointments/:id/arrive` moves `ON_THE_WAY` appointments to
  `ARRIVED`.
- `POST /api/appointments/:id/start` moves `SCHEDULED`, `CONFIRMED` or
  `ARRIVED` appointments to `IN_PROGRESS`.
- `PATCH /api/appointments/:id/work-log` saves internal technician notes, work
  completed notes and follow-up flags.
- `POST /api/appointments/:id/complete` requires `workCompleted`, saves the
  work log and moves `IN_PROGRESS` appointments to `COMPLETED`.

The API validates transitions again even when the mobile UI hides unavailable
actions.

## AI endpoint rule

AI endpoints must produce drafts, recommendations, or summaries by default. Any endpoint that sends, executes, confirms, or modifies important data must require explicit user confirmation.
