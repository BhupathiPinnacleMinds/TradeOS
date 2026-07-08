# Roadmap

## Roadmap principles

The roadmap must prioritise work that makes Tori more useful as an AI Office Manager. Features should be sequenced so each phase strengthens the foundation for the next.

## Phase 1: Foundation

Status: in progress.

Goals:

- Establish monorepo structure.
- Build mobile app foundation.
- Build API foundation.
- Establish database and tenant model.
- Add authentication.
- Add business workspace registration.
- Seed demo data.
- Create database-backed dashboard.
- Add placeholder module screens.

Modules:

- Authentication
- Business
- Team
- Customers
- Jobs
- Quotes
- Invoices
- Dashboard

Current completed items:

- Expo React Native app.
- NestJS API.
- PostgreSQL with Prisma.
- JWT login/register.
- Secure token storage on mobile.
- Demo business seed.
- Business-scoped dashboard summary.

## Phase 2: Tori AI and operating workflows

Goals:

- Make Tori useful in the daily workflow.
- Support draft-first AI actions.
- Add notifications, documents, reports, payments, and integrations.

Modules:

- Tori chat
- AI conversation history
- AI action drafts
- Quote draft generation
- Invoice draft generation
- Customer reply drafts
- SMS and email draft workflows
- Payment follow-up drafts
- Notifications
- Documents
- Reports
- Payments
- Integrations

Safety requirements:

- Tori must never send SMS, email, quote, or invoice without confirmation.
- Tori must never modify financial data without confirmation.
- AI outputs must be scoped to the logged-in business.

## Phase 3: Advanced AI and platform scale

Goals:

- Expand Tori from assistant to proactive office manager.
- Improve field productivity and business intelligence.
- Add advanced mobile and offline capabilities.

Modules:

- AI voice
- AI vision
- AI scheduling
- Mobile widgets
- Offline mode
- Route and map assistance
- Weather-aware scheduling
- Smart quote recommendations
- Business coaching
- Advanced integrations

## Future integrations

- Stripe
- Twilio
- SendGrid
- Firebase Push
- Google Calendar
- Google Maps
- Xero
- MYOB
- QuickBooks

## Roadmap guardrail

Do not build roadmap items merely because competitors have them. Build only when the feature helps tradies save time, make money, or reduce stress.
