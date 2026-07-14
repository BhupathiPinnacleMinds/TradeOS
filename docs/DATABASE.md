# Database

## Overview

TradieOS uses PostgreSQL with Prisma. The database is multi-tenant: business-owned data is scoped to a `Business` workspace through `businessId`.

## Current implementation status

Current Prisma models include:

- Business
- User
- BusinessMember
- Customer
- Job
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

Represents work or potential work.

Important fields:

- id
- businessId
- customerId
- title
- description
- status
- startsAt
- endsAt
- address

Statuses:

- LEAD
- QUOTED
- SCHEDULED
- IN_PROGRESS
- COMPLETED
- CANCELLED

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

## Relationships

- Business has many users, members, customers, jobs, quotes, invoices, payments, messages, notifications, AI conversations, documents, integrations, and audit logs.
- BusinessMember belongs to a business and may belong to a user.
- Customer has many jobs, quotes, invoices, and messages.
- Job belongs to customer and may have quotes, invoices, messages, and documents.
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

## Security

Database security rules:

- Never query tenant-owned data without `businessId`.
- Use compound relations where practical to prevent cross-tenant linkage.
- Do not trust user-provided `businessId`.
- Use authenticated JWT claims to scope API queries.

## Migration rule

All schema changes must include Prisma migrations and updated documentation when they change product concepts or access rules.
