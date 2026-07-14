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
- Accept Invitation
- Dashboard
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
