# Roles and Permissions

## Overview

Roles define what a user can see and do inside a business workspace.

Current implementation supports:

- OWNER
- ADMIN
- STAFF

Target role model:

- OWNER
- ADMIN
- OFFICE_MANAGER
- SCHEDULER
- TECHNICIAN
- ACCOUNTANT
- SALES
- READ_ONLY

Future work should migrate from `STAFF` to more granular roles.

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
- create and update jobs
- schedule jobs
- manage job notifications
- draft customer scheduling messages

Should not:

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

Future permissions should be action-based:

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

## Tenant rule

Roles never grant cross-business access.

Even `OWNER` can only access their own business workspace.
