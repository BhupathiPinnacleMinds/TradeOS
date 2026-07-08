# API

## Overview

TradieOS uses a REST API built with NestJS. API routes are prefixed with:

```text
/api
```

## Current implemented endpoints

### Health

```http
GET /api/health
```

Returns service health.

### Register

```http
POST /api/auth/register
```

Creates a business workspace and owner user.

Required user fields:

- firstName
- lastName
- email
- password

Required business fields:

- businessName
- tradeType
- gstRegistered

Optional business fields:

- abn
- phone
- businessEmail
- address
- suburb
- state
- postcode

### Login

```http
POST /api/auth/login
```

Returns JWT and user/business profile.

### Current user

```http
GET /api/auth/me
```

Requires JWT. Returns logged-in user and business.

### Demo token

```http
GET /api/auth/demo-token
```

Development-only helper. Must remain disabled in production.

### Dashboard summary

```http
GET /api/dashboard/summary
```

Requires JWT. Reads live database records scoped to the logged-in user’s business.

## API standards

### REST

Use REST endpoints grouped by domain:

```text
/api/customers
/api/jobs
/api/quotes
/api/invoices
/api/payments
/api/messages
/api/ai
/api/notifications
/api/dashboard
```

### Versioning

Future public API versions should use one of:

```text
/api/v1/...
```

or explicit Nest versioning. Do not introduce versioning until needed.

### Validation

Use Nest validation pipes and DTO classes.

Rules:

- Validate request bodies.
- Whitelist accepted fields.
- Reject unknown unsafe fields.
- Do not accept `businessId` from request bodies for tenant scoping.

### Error handling

Use standard HTTP status codes:

- 400: invalid request
- 401: unauthenticated
- 403: authenticated but not allowed
- 404: not found within tenant scope
- 409: conflict
- 500: server error

Errors should be clear but should not leak sensitive data.

### Pagination

Future list endpoints should support pagination:

```text
limit
cursor
```

or:

```text
page
pageSize
```

Cursor pagination is preferred for large datasets.

### Filtering

Filters must remain tenant-scoped.

Example:

```text
GET /api/jobs?status=SCHEDULED
```

The API must still derive `businessId` from JWT.

### Authorization

Every protected route must use JWT auth.

Authorization should check:

- user is active
- user belongs to business
- role has permission
- data belongs to business

### Business isolation

Never expose cross-business data.

Correct pattern:

```ts
where: {
  businessId: currentUser.businessId,
  id: recordId,
}
```

Incorrect pattern:

```ts
where: {
  id: recordId,
}
```

## Response contracts

Shared response contracts should live in `packages/shared` when used by both API and mobile.

## AI endpoint rule

AI endpoints must produce drafts, recommendations, or summaries by default. Any endpoint that sends, executes, confirms, or modifies important data must require explicit user confirmation.
