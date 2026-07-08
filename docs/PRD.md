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
- Basic navigation and placeholder screens for modules.

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
- outstanding invoices
- customer count
- unread notifications
- latest notifications
- Tori daily priority

### Customers

Customers represent households, individuals, businesses, or recurring clients. Customers must always be scoped to a business.

### Jobs

Jobs represent service work, visits, leads, scheduled jobs, completed work, or cancelled jobs.

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

Current implementation supports a smaller set (`OWNER`, `ADMIN`, `STAFF`). Future work should migrate toward the full role model documented in [Roles and Permissions](./ROLES_AND_PERMISSIONS.md).

## Acceptance criteria

- Every future feature must reference this PRD.
- Any implementation conflicting with this PRD must be rejected.
- Every new tenant-owned entity must include business isolation.
- Every customer-facing AI action must require user confirmation before sending.
- Every implementation must keep mobile usability central.
