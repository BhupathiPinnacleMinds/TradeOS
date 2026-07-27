# Database

## MediaAsset

`MediaAsset` is the tenant-scoped foundation for job photos, appointment
evidence and customer/job documents.

Key rules:

- Every row includes `businessId`.
- Media can be linked to `customerId`, `jobId` and/or `appointmentId`.
- `objectKey` is stored only server-side and is unique per business.
- API responses return metadata and authorised access URLs, never raw object
  keys.
- Files are soft-archived with `archivedAt`; physical deletion is reserved for a
  future retention/purge policy.
- Supported categories include before/progress/after photos, damage evidence,
  customer supplied files, compliance certificates, warranties, plans, permits,
  receipts, material invoices and general documents.

Local development stores small files under `STORAGE_LOCAL_PATH`. Production is
prepared for S3-compatible storage through `STORAGE_PROVIDER=s3` and the S3 env
vars documented in `apps/api/.env.example`.

## Overview

TradieOS uses PostgreSQL with Prisma. The database is multi-tenant: business-owned data is scoped to a `Business` workspace through `businessId`.

## Current implementation status

Current Prisma models include:

- Business
- User
- BusinessMember
- Customer
- Job
- JobSequence
- Appointment
- AppointmentSequence
- Quote
- QuoteLineItem
- Invoice
- InvoiceLineItem
- Payment
- Message
- Notification
- AiConversation
- AiMessage
- AiAction
- Document
- Integration
- AuditLog

Future documentation names may use `QuoteItem`, `InvoiceItem`, and `MessageDraft`; in the current implementation, quote/invoice items are represented by line item models, and message drafts are represented through `Message.status`.

## Entity definitions

### Business

Represents a tenant workspace.

Important fields:

- id
- name
- abn
- tradeType
- gstRegistered
- phone
- email
- address
- suburb
- state
- postcode
- timezone
- createdAt
- updatedAt

Timezone rules:

- `Business.timezone` stores an IANA timezone and defaults to
  `Australia/Melbourne`.
- Business timestamps are stored as UTC instants in PostgreSQL.
- UI display and business-day querying convert UTC values through the business
  timezone, never through hardcoded UTC offsets.
- Seed data may choose a realistic demo timezone, such as `Australia/Sydney`
  for the NSW demo company, but generated appointment slots must still be
  created as business-local times converted to UTC.

Relationships:

- users
- members
- customers
- jobs
- quotes
- invoices
- payments
- messages
- notifications
- aiConversations
- aiMessages
- aiActions
- documents
- integrations

### User

Represents a user account belonging to a business.

Important fields:

- id
- businessId
- email
- passwordHash
- firstName
- lastName
- role
- isActive
- createdAt
- updatedAt

Current roles:

- OWNER
- ADMIN
- OFFICE_MANAGER
- SCHEDULER
- TECHNICIAN
- ACCOUNTANT
- SALES
- READ_ONLY
- STAFF legacy compatibility role

### BusinessMember

Represents a user or invitation inside a business workspace. `User.businessId` and `User.role` are retained for the current single-workspace auth flow, while `BusinessMember` stores invite state, member status, last login, and future membership metadata.

Important fields:

- id
- businessId
- userId
- role
- status
- invitedEmail
- invitedFirstName
- invitedLastName
- inviteTokenHash
- inviteExpiresAt
- inviteAcceptedAt
- inviteCancelledAt
- invitedBy
- invitedAt
- joinedAt
- lastLoginAt
- createdAt
- updatedAt

Statuses:

- INVITED
- ACTIVE
- SUSPENDED

Invitation tokens are never stored in raw form. The API stores only a SHA-256 hash, gives the raw token to the inviter once for the invite URL in development, expires invites after 7 days by default, and clears the hash after successful acceptance or cancellation. Pending invitations store first and last name on `BusinessMember`; no `User` account is created until the invite is accepted. Cancelled invitations remain in this table for audit continuity but are excluded from normal Team list queries.

### Customer

Represents a business-scoped customer or client. Customers are archived rather than hard deleted so future jobs, quotes, invoices, payments, messages, documents, notifications and Tori history can continue to reference them.

Important fields:

- id
- businessId
- firstName
- lastName
- displayName
- companyName
- email
- emailNormalised
- phone
- phoneNormalised
- alternatePhone
- addressLine1
- addressLine2
- suburb
- state
- postcode
- contactPreference
- customerType
- notes
- tags
- isArchived
- archivedAt
- createdBy
- updatedBy
- status
- createdAt
- updatedAt

Relationships:

- sites
- jobs
- quotes
- invoices
- messages

Validation and storage:

- `businessId` is always from the authenticated context, never client input.
- `firstName` or `companyName` is required.
- `email` or `phone` is required.
- Australian states are limited to `VIC`, `NSW`, `QLD`, `SA`, `WA`, `TAS`, `ACT`, `NT`.
- Postcode must be four digits when supplied.
- `emailNormalised` and `phoneNormalised` are used for duplicate detection only and are not displayed in the UI.

### CustomerSite

Represents a service location for a customer. This supports landlords, property managers, builders, commercial customers and other multi-site tradie workflows.

Important fields:

- id
- businessId
- customerId
- label
- addressLine1
- addressLine2
- suburb
- state
- postcode
- accessInstructions
- siteContactName
- siteContactPhone
- isPrimary
- isArchived
- createdAt
- updatedAt

Rules:

- Each site is scoped by `businessId`.
- Each site references a customer with the same `businessId`.
- Only one active site should be primary per customer; setting a site as primary clears the previous primary site.
- Sites are archived rather than hard deleted.

### Job

Represents work or potential work. Jobs describe the work request; appointments
describe when visits happen and who performs them.

Important fields:

- id
- businessId
- customerId
- assignedToUserId
- jobNumber
- title
- description
- status
- priority
- scheduledStart
- scheduledEnd
- addressLine1
- suburb
- state
- postcode

Statuses:

- NEW
- SCHEDULED
- ON_THE_WAY
- IN_PROGRESS
- ON_HOLD
- COMPLETED
- CANCELLED

### Appointment

Represents one scheduled visit for a job. A job can have many appointments,
such as inspection, installation, maintenance, return visit or emergency visit.

Important fields:

- id
- businessId
- jobId
- customerSiteId
- assignedUserId
- appointmentNumber
- appointmentType
- locationSource
- status
- scheduledStart
- scheduledEnd
- actualStart
- actualEnd
- estimatedDurationMinutes
- travelDurationMinutes
- travelDistanceKm
- addressLine1
- addressLine2
- suburb
- state
- postcode
- accessInstructions
- notes
- createdBy
- updatedBy

Statuses:

- SCHEDULED
- CONFIRMED
- ON_THE_WAY
- ARRIVED
- IN_PROGRESS
- COMPLETED
- CANCELLED
- NO_SHOW
- RESCHEDULED

Scheduling rules:

- Appointments are the canonical future calendar record.
- Appointment rows remain tenant-scoped with `businessId`.
- Appointment rows store a visit-location snapshot copied from a customer service site, the customer default address, or a manual one-off address.
- Manual one-off appointment addresses do not create a permanent customer service site unless the user explicitly chooses to save the address as a site.
- The current reschedule model keeps one active appointment row and records `APPOINTMENT_RESCHEDULED` in audit/timeline metadata. Active appointments remain `SCHEDULED` or `CONFIRMED` after date/time changes.
- Calendar conflict detection compares assigned technician, scheduled start/end, closed statuses and business working hours.
- Business working-hour validation uses the business timezone and current
  default hours of 07:00-18:00 local business time. Technician working hours,
  lunch breaks and public holidays are future extension points.

### Quote

Represents a quote sent or drafted for a customer.

Important fields:

- id
- businessId
- customerId
- jobId
- number
- status
- issueDate
- expiryDate
- subtotal
- gst
- total
- notes
- sentAt

### QuoteItem / QuoteLineItem

Represents quote line items.

Important fields:

- id
- businessId
- quoteId
- description
- quantity
- unitPrice
- total
- sortOrder

### Invoice

Represents an invoice for a customer.

Important fields:

- id
- businessId
- customerId
- jobId
- number
- status
- issueDate
- dueDate
- subtotal
- gst
- total
- amountPaid
- notes
- sentAt

### InvoiceItem / InvoiceLineItem

Represents invoice line items.

Important fields:

- id
- businessId
- invoiceId
- description
- quantity
- unitPrice
- total
- sortOrder

### Payment

Represents an invoice payment.

Important fields:

- id
- businessId
- invoiceId
- amount
- status
- method
- reference
- paidAt

### MessageDraft / Message

Represents SMS, email, or internal messages. Drafts are represented by message status.

Important fields:

- id
- businessId
- customerId
- jobId
- channel
- direction
- status
- recipient
- subject
- body
- confirmedBy
- confirmedAt
- sentAt

Important rule:

Tori may draft messages, but messages must not be sent without user confirmation.

### Notification

Represents reminders, alerts, updates, and system messages.

Important fields:

- id
- businessId
- userId
- title
- body
- status
- readAt
- createdAt

### AiConversation

Represents a Tori conversation.

Important fields:

- id
- businessId
- userId
- title
- createdAt
- updatedAt

### AiMessage

Represents individual AI conversation messages.

Important fields:

- id
- businessId
- conversationId
- role
- content
- createdAt

### Document

Represents files and future generated PDFs.

Important fields:

- id
- businessId
- jobId
- name
- mimeType
- storageKey

### Integration

Represents tenant-scoped external integrations.

Important fields:

- id
- businessId
- provider
- externalId
- credentials
- isActive

### AuditLog

Represents tenant-scoped audit history for sensitive business actions. Team management writes audit logs now; future modules should reuse this table for high-risk actions.

Important fields:

- id
- businessId
- actorUserId
- action
- entityType
- entityId
- metadata
- createdAt

### AppointmentWorkLog

Represents technician-entered field notes for one appointment visit.

Important fields:

- id
- businessId
- appointmentId
- jobId
- technicianUserId
- technicianNotes
- workCompleted
- followUpRequired
- followUpNotes
- createdAt
- updatedAt

## Relationships

- Business has many users, members, customers, jobs, appointments, quotes, invoices, payments, messages, notifications, AI conversations, documents, integrations, and audit logs.
- Business has one `JobSequence` row used to generate per-business job numbers.
- Business has one `AppointmentSequence` row used to generate per-business appointment numbers.
- BusinessMember belongs to a business and may belong to a user.
- Customer has many jobs, quotes, invoices, and messages.
- Job belongs to a business and customer, may be assigned to a user, and can have appointments, quotes, invoices, messages and documents.
- Appointment belongs to a business and job, may be assigned to a user, and may
  have one current `AppointmentWorkLog`.
- AppointmentWorkLog belongs to a business, appointment, job and technician
  user. It is unique per business/appointment.
- Quote belongs to customer and may belong to a job.
- Invoice belongs to customer and may belong to a job.
- Payment belongs to invoice.
- Notification belongs to user and business.
- AI conversation belongs to user and business.
- Audit log belongs to business and may belong to an actor user.

## Indexes

Indexes should begin with `businessId` for tenant-owned access patterns.

Current examples:

- customer status by business
- customer name by business
- job status/start date by business
- quote status/issue date by business
- invoice status/due date by business
- notification user/status by business
- AI conversation user/update time by business
- business member role/status by business
- audit log action/entity by business
- appointment work log by business/appointment, business/job and
  business/technician

## Security

Database security rules:

- Never query tenant-owned data without `businessId`.
- Use compound relations where practical to prevent cross-tenant linkage.
- Do not trust user-provided `businessId`.
- Use authenticated JWT claims to scope API queries.

## Migration rule

All schema changes must include Prisma migrations and updated documentation when they change product concepts or access rules.

Timezone default migration:

- `20260724123000_business_timezone_default_melbourne` updates the Prisma
  default for new business workspaces from Sydney to Melbourne.
