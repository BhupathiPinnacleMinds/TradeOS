# Roles and Permissions

## Media & document permissions

- `OWNER`, `ADMIN` and `OFFICE_MANAGER` can upload, edit metadata, archive and
  restore media.
- `SCHEDULER` can upload operational photos/documents but cannot upload
  financial categories.
- `TECHNICIAN` can upload and view media for assigned appointments/jobs and can
  edit their own recent uploads.
- `ACCOUNTANT` can view financial media categories only.
- `SALES` can upload customer/sales context documents.
- `READ_ONLY` can view permitted media but cannot mutate it.

## Overview

Roles define what a user can see and do inside a business workspace.

Current implementation supports:

- OWNER
- ADMIN
- OFFICE_MANAGER
- SCHEDULER
- TECHNICIAN
- ACCOUNTANT
- SALES
- READ_ONLY
- STAFF as a legacy compatibility role

New invitations should use the granular roles instead of `STAFF`.

## Role responsibilities

### OWNER

Business owner with full access.

Can:

- manage business profile
- manage users and roles
- view all records
- create and edit customers
- create and edit jobs
- create, approve, and send quotes
- create, approve, and send invoices
- manage payments
- manage integrations
- approve Tori actions

### ADMIN

Senior admin with broad access.

Can:

- manage most business records
- manage customers and jobs
- manage quotes and invoices
- approve most Tori actions
- view reports

Should not:

- delete business workspace
- transfer ownership

### OFFICE_MANAGER

Office operator responsible for daily admin.

Can:

- manage customers
- manage jobs
- prepare quote and invoice drafts
- draft and send approved messages
- handle reminders and notifications
- coordinate Tori actions

### SCHEDULER

Responsible for calendar and dispatch.

Can:

- view customers
- create and update customers
- create and update jobs
- schedule jobs
- manage job notifications
- draft customer scheduling messages

Should not:

- archive or restore customers
- edit financial totals
- mark invoices paid

### TECHNICIAN

Field worker.

Can:

- view assigned jobs
- view customer contact and job notes
- update job status
- upload documents/photos
- add internal notes

Should not:

- see full financial reports unless permitted
- manage business settings

### ACCOUNTANT

Financial operator.

Can:

- view customer identity and billing contact details
- view invoices
- view payments
- update payment status
- export reports
- manage accounting integrations

Should not:

- schedule jobs unless separately permitted

### SALES

Quote and lead-focused user.

Can:

- manage leads
- manage customers
- create quote drafts
- follow up quotes
- use Tori for sales communication drafts

Should not:

- manage payments unless permitted

### READ_ONLY

Viewer role.

Can:

- view permitted records
- view dashboard
- view reports if allowed

Cannot:

- create
- update
- delete
- send
- approve Tori actions

## Permission model

Current implementation uses role checks for team and customer management. Future permissions should become action-based:

```text
customers.read
customers.write
jobs.read
jobs.write
quotes.create
quotes.approve
quotes.send
invoices.create
invoices.approve
invoices.send
payments.write
messages.send
ai_actions.confirm
reports.read
settings.write
integrations.write
```

Implemented customer permissions:

- `OWNER`, `ADMIN`, `OFFICE_MANAGER`: create, view, update, archive and restore customers and customer sites.
- `SCHEDULER`, `SALES`: create, view and update customers and customer sites, but cannot archive/restore.
- `ACCOUNTANT`, `READ_ONLY`: view customers only.
- `TECHNICIAN`: broad customer-list access is blocked until assigned-job scoping exists.

Implemented job permissions:

- `OWNER`, `ADMIN`, `OFFICE_MANAGER`: create, view, update, assign, archive, restore and update job status.
- `SCHEDULER`: create, view, update, assign, reschedule and update job status, but cannot archive/restore jobs.
- `TECHNICIAN`: view assigned jobs and update assigned job status/notes.
- `ACCOUNTANT`, `SALES`, `READ_ONLY`: view jobs only.

Implemented appointment permissions:

- `OWNER`, `ADMIN`, `OFFICE_MANAGER`: create, view, update, assign, reschedule and update appointment status.
- `SCHEDULER`: create, view, update, assign and reschedule appointments.
- `TECHNICIAN`: view assigned appointments, use My Day, update workflow status
  on assigned appointments only, and save technician/work-completed notes.
- `ACCOUNTANT`, `SALES`, `READ_ONLY`: view appointments only.
- Dispatcher is treated as scheduling management and is limited to `OWNER`,
  `ADMIN`, `OFFICE_MANAGER` and `SCHEDULER`.

Technician workflow permissions:

- Technicians can only receive `/appointments/my-day` data for their own user
  ID.
- Technicians cannot reassign appointments.
- Read-only, accountant and sales roles cannot perform field workflow status
  transitions.
- Owners can use My Day for appointments assigned to their own user account
  without losing owner dashboard access.

## Implemented mobile navigation visibility

Mobile navigation is role-aware and should hide inaccessible screens instead of
letting a user open a screen and then showing a permission error.

| Role             | Bottom navigation                        |
| ---------------- | ---------------------------------------- |
| `OWNER`          | Dashboard, Calendar, Jobs, Tori, More    |
| `ADMIN`          | Dashboard, Calendar, Jobs, Tori, More    |
| `OFFICE_MANAGER` | Dashboard, Calendar, Jobs, Tori, More    |
| `SCHEDULER`      | Dashboard, Calendar, Jobs, Tori, More    |
| `TECHNICIAN`     | My Day, Calendar, Tori, More             |
| `ACCOUNTANT`     | Dashboard, Tori, More                    |
| `SALES`          | Dashboard, Customers, Quotes, Tori, More |
| `READ_ONLY`      | Dashboard, Calendar, More                |

The mobile role visibility matrix is centralised in one helper. Deep links,
manual navigation calls, or stale navigation state for forbidden screens should
fall back to the user’s permitted home instead of rendering forbidden screens.

## Tenant rule

Roles never grant cross-business access.

Even `OWNER` can only access their own business workspace.
