# Coding Standards

## Overview

TradieOS uses TypeScript across the monorepo. Code should be clear, testable, tenant-safe, and easy to extend.

## Folder structure

Current structure:

```text
apps/api/src/
  auth/
  businesses/
  customers/
  dashboard/
  jobs/
  quotes/
  invoices/
  payments/
  messages/
  ai/
  notifications/
  documents/
  reports/
  integrations/
  prisma/

apps/mobile/src/
  api/
  auth/
  components/
  navigation/
  screens/
  theme.ts

packages/shared/src/
```

## Naming conventions

- Use PascalCase for React components.
- Use camelCase for functions and variables.
- Use kebab-case for route paths.
- Use singular Prisma model names.
- Use DTO suffix for API request DTOs.
- Use Service suffix for business logic services.

## Service layer

Controllers should remain thin.

Controllers should:

- accept request
- validate via DTOs
- read current user/business
- call service
- return response

Services should:

- hold business logic
- enforce tenant filters
- coordinate Prisma operations
- handle domain rules

## Repository pattern

The current project uses Prisma directly in services. A repository layer may be introduced later if domain complexity grows.

Do not introduce repositories prematurely.

## Prisma best practices

- Always scope tenant-owned queries by `businessId`.
- Prefer transactions for multi-record writes.
- Use compound relations to prevent cross-tenant linkage.
- Keep migrations committed.
- Regenerate Prisma client after schema changes.
- Seed data should be deterministic where practical.

## React best practices

- Keep screens focused.
- Move shared API calls to `src/api`.
- Move auth/session state to `src/auth`.
- Avoid duplicating fetch logic inside screens.
- Keep forms simple.
- Use platform-aware secure storage.

## NestJS best practices

- Use modules per domain.
- Use DTO validation.
- Use guards for auth/roles.
- Keep controllers thin.
- Keep services testable.
- Do not leak internal errors.

## Testing strategy

Minimum checks before committing:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:e2e
```

Feature-level testing should include:

- happy path
- validation errors
- unauthenticated access
- wrong business access
- role denial
- AI confirmation requirements where relevant

## Documentation rule

If a change affects product direction, architecture, database, security, roles, or API contracts, update `/docs`.

## Feature rejection rule

Reject or redesign any implementation that:

- bypasses business isolation
- trusts request `businessId`
- lets Tori send without confirmation
- stores secrets in Git
- adds complexity unrelated to saving time, making money, or reducing stress
