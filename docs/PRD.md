# Product Requirements Document

## Project overview

**Product name:** TradieOS  
**AI assistant name:** Tori  
**Tagline:** Your AI Office Manager

TradieOS is an AI-first SaaS app for Australian tradies. It helps trade businesses handle the office work that normally happens after hours: quotes, invoices, customer replies, job reminders, payment follow-ups, daily priorities, and customer history summaries.

This PRD is the master product reference. All future feature implementations must align with it.

## Executive summary

Australian tradies often lose time and money because admin work is fragmented, delayed, or done after a long day on the tools. TradieOS solves this by providing Tori, an AI Office Manager that helps prepare work, surface priorities, and draft customer communications.

TradieOS must remain simple, mobile-first, and business-focused. It should make a tradie feel more organised without making them feel like they are operating a complex back-office system.

## Mission

Give every Australian tradie a reliable AI office manager that saves time, improves cash flow, and reduces admin stress.

## Vision

TradieOS becomes the trusted AI office layer for Australian trade and service businesses, connecting customer records, jobs, quotes, invoices, messages, reminders, documents, and insights through Tori.

## Goals

- Let users register and create a business workspace.
- Keep all business data tenant-isolated by `businessId`.
- Provide secure JWT authentication.
- Show a logged-in business dashboard from live database data.
- Support business roles and future permissions.
- Create a scalable architecture for customers, jobs, quotes, invoices, payments, messages, documents, notifications, reports, integrations, and AI.
- Make Tori useful as an AI office manager without allowing unsafe autonomous actions.

## Non-goals

- Do not build generic features unrelated to tradie office work.
- Do not copy large enterprise job management tools.
- Do not let Tori send or modify important data without confirmation.
- Do not permit cross-business access.
- Do not optimise for desktop-first workflows over mobile-first usage.

## Current implementation

The current implementation includes:

- Expo React Native mobile app with web support.
- NestJS API with TypeScript.
- PostgreSQL database.
- Prisma schema and migrations.
- Multi-tenant `Business` workspace.
- User registration and login.
- JWT authentication.
- Mobile token storage using Expo SecureStore.
- Demo seed data.
- Dashboard summary from database.
- Team Management and invitation acceptance.
- Customer Management with mobile list, add/edit, details, archive/restore, duplicate warning and service-location support.
- Job Management with mobile list, add/edit, details, assignment, status transitions, archive/restore, dashboard metrics and customer-linked jobs.
- Calendar & Appointment Management with day, week, month and agenda views, appointment details, technician filters, Dispatcher View, conflict detection, availability APIs and assignment-only appointment reassignment.
- Basic navigation and placeholder screens for remaining modules.

## Target customers

- Australian tradies
- Solo tradies
- Small teams
- Growing businesses
- Large businesses

## Supported trades

- Electrician
- Plumber
- Painter
- Cleaner
- HVAC
- Builder
- Handyman
- Removalist
- Pest control
- Lawn mowing
- Mobile mechanic
- Carpenter
- Other

## Core product modules

### Authentication

Users must be able to register, log in, log out, and access only their own business workspace. JWT auth is the current standard.

### Business workspace

Each user belongs to a business workspace. Registration creates a business and owner user.

Business profile fields:

- businessName
- ABN
- tradeType
- gstRegistered
- phone
- email
- address
- suburb
- state
- postcode

### Dashboard

The dashboard must show live data scoped to the logged-in user’s business:

- business name
- jobs today
- upcoming jobs
- jobs completed today
- overdue jobs
- outstanding invoices
- customer count
- unread notifications
- latest notifications
- Tori daily priority

### Customers

Customers represent households, individuals, businesses, or recurring clients. Customers must always be scoped to a business.

Implemented customer management supports Australian customer profiles, contact preference, customer type, archive/restore, duplicate warnings and multiple service locations. Future jobs, quotes, invoices, documents and Tori history should link back to these customer records rather than creating parallel customer data.

### Jobs

Jobs represent service work, visits, leads, scheduled jobs, completed work, or cancelled jobs.

Implemented job management supports customer-linked work records, per-business job numbers, assignment, priority, schedule, address, status transitions, archive/restore and audit history. Future quotes, invoices, photos, documents, calendar events, notifications, reports and Tori summaries should link to the Job record rather than duplicating job data.

### Quotes

Quotes must support line items, GST, totals, status, customer linkage, and optional job linkage.

### Invoices

Invoices must support line items, GST, totals, paid amount, status, customer linkage, and optional job linkage.

### Payments

Payments track invoice payments, payment method, status, and payment timing.

### Messages

Messages and message drafts represent SMS, email, or internal communication. Tori may draft messages but must not send them without confirmation.

### Notifications

Notifications surface important reminders, follow-ups, and system events.

### Documents

Documents support future attachments, quote PDFs, invoice PDFs, job photos, certificates, and customer files.

### Reports

Reports should help the business understand cash flow, unpaid invoices, quote conversion, job load, and daily priorities.

### Integrations

Integrations are future-facing and should be modular. Potential integrations include Stripe, Twilio, SendGrid, Firebase Push, Google Calendar, Google Maps, Xero, MYOB, and QuickBooks.

## Tori AI requirements

Tori is an AI employee, not a chatbot.

Tori can:

- create quote drafts
- create invoice drafts
- draft emails
- draft SMS
- reply to customers with approval
- schedule job suggestions
- generate daily summaries
- provide business insights
- prepare invoice follow-ups
- summarise customer history
- summarise jobs
- assist with calendar planning
- use weather awareness when relevant
- provide business coaching

Tori must not:

- send messages without confirmation
- send quotes without confirmation
- send invoices without confirmation
- modify financial data without confirmation
- expose another business’s data

## Multi-tenant requirements

Every business-owned record must include `businessId` or be reachable only through a business-scoped parent. API requests must derive business scope from the authenticated JWT, not from user-submitted query parameters.

The default rule:

```text
No businessId from request body or query string should be trusted for tenant access.
```

## Roles

Supported role model:

- OWNER
- ADMIN
- OFFICE_MANAGER
- SCHEDULER
- TECHNICIAN
- ACCOUNTANT
- SALES
- READ_ONLY

Current implementation supports the full role model documented in [Roles and Permissions](./ROLES_AND_PERMISSIONS.md). `STAFF` remains only as a legacy compatibility role; new invitations should use granular roles.

## Acceptance criteria

- Every future feature must reference this PRD.
- Any implementation conflicting with this PRD must be rejected.
- Every new tenant-owned entity must include business isolation.
- Every customer-facing AI action must require user confirmation before sending.
- Every implementation must keep mobile usability central.

## Appointment and smart scheduling requirements

- Jobs represent the work request.
- Appointments represent when work happens and who performs it.
- One job may have multiple appointments.
- Calendar, Tori scheduling, notifications and travel planning must use appointments as the future scheduling source.
- Smart assignment must start without AI by recommending available technicians based on working hours and existing appointment conflicts.
- Quick job creation may create a minimal customer and job together when the customer does not already exist.
- Appointment actions must be tenant-scoped, permission-aware and audit logged.
- Calendar UI must show detailed appointment schedules; Dashboard should show scheduling summaries only.
- Appointment reassignment must never create a duplicate appointment or change the job, customer, time, notes or visit-location snapshot. It changes only the technician assignment, checks conflicts, records old/new technicians in audit history and refreshes Calendar, Dashboard, Job Details and Appointment Details views through normal API reloads.
- Dispatcher View is an additional operations board inside Calendar. It must show technician workload, current status, completed/upcoming counts, unassigned appointments, recommendations and quick actions without replacing Calendar. Future drag-and-drop scheduling should plug into the exposed move/reassign actions instead of redesigning appointments.
- Technician Field Workflow gives technicians and solo owners a fast My Day
  view over assigned appointments. It supports navigate, start travel, arrived,
  start work, completion review, technician notes, work-completed notes and
  follow-up flags while keeping job and appointment status separate.
- Media evidence capture lets authorised users take photos, choose photo-library
  images and attach supported documents to customers, jobs and appointments
  through the tenant-scoped Media API. Users review files before upload; picker
  selection alone never sends or publishes evidence.
