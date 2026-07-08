# Security

## Security overview

TradieOS is a multi-tenant SaaS app. Security must protect customer data, business data, financial records, communications, and AI context.

## Current security implementation

- JWT authentication.
- Password hashing using `scrypt`.
- Mobile token storage using Expo SecureStore.
- Business workspace scoping through `businessId`.
- Prisma relations and query filters for tenant isolation.
- Role field on users.
- CORS configured for local development origins.

## JWT

JWT payload contains:

- `sub`: user ID
- `businessId`: business workspace ID

JWT rules:

- Validate on every protected route.
- Reject inactive users.
- Derive business scope from JWT.
- Do not accept tenant scope from request body.

## Tenant isolation

Tenant isolation is mandatory.

Every protected query must filter by authenticated `businessId`.

Correct:

```ts
where: {
  id,
  businessId: currentUser.businessId,
}
```

Incorrect:

```ts
where: {
  id,
}
```

## Role-based access

Current roles:

- OWNER
- ADMIN
- STAFF

Future roles:

- OWNER
- ADMIN
- OFFICE_MANAGER
- SCHEDULER
- TECHNICIAN
- ACCOUNTANT
- SALES
- READ_ONLY

Role checks must be enforced in API guards and services.

## Audit logs

Future audit logs should record:

- user ID
- business ID
- action
- entity type
- entity ID
- timestamp
- before/after for sensitive changes
- AI action confirmation metadata

Audit logs are required before high-risk features such as sending invoices, payment changes, or integration sync.

## Encryption

Current:

- Passwords are hashed, not encrypted.
- JWT is stored securely on mobile.

Future:

- Encrypt sensitive integration credentials.
- Use managed secrets.
- Use encrypted backups.
- Consider field-level encryption for high-risk fields.

## Future MFA

MFA should be added for:

- owners
- admins
- accounting access
- integration management

## AI security

Tori must never access data outside the user’s business.

AI prompts must not include unrelated tenant data.

AI tools must enforce the same authorization rules as normal API services.

## Secret handling

Secrets must not be committed.

Use:

- `.env` locally
- platform secrets in production
- secret manager for production integrations

## Security acceptance criteria

- No cross-business data access.
- No unauthenticated protected data.
- No unconfirmed AI sending.
- No plaintext password storage.
- No secrets in Git.
