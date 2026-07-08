# Architecture

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
- Dashboard
- Tori Chat
- Customers
- Jobs
- Quotes
- Invoices
- Notifications
- Settings
- More

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
