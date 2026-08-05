# Security

## Media security

- Media metadata and access are always filtered by the authenticated user
  `businessId`.
- Raw object keys are never returned to the mobile app.
- Local file access goes through `GET /api/media/:id/file` after JWT, tenant and
  role checks.
- Mobile clients must not open protected API media URLs directly in Safari or
  the system browser. They first download through the authenticated API client
  with the bearer token into the app cache, then open the local cached file or a
  short-lived blob URI.
- Media API access responses use API-relative paths such as
  `/media/:id/file`; clients normalise them against the configured API base URL
  and must never create or render `/api/api/...` URLs.
- Technicians can only access media for their assigned appointments/jobs or
  files they uploaded.
- Accountants are restricted to financial media categories such as receipts and
  material invoices.
- Read-only users can view permitted media metadata but cannot upload, edit or
  archive files.
- Media removal is soft archive only. The API enforces business scope, role,
  uploader ownership and context assignment before setting `archivedAt`.
  Technicians may archive only their own recent ordinary photos within the
  24-hour correction window on assigned work. Protected categories
  (`COMPLIANCE_CERTIFICATE`, `WARRANTY`, `PERMIT`, `MATERIAL_INVOICE`,
  `RECEIPT`) require Owner/Admin authority except for explicitly permitted
  accountant financial-document handling.
- Upload validation rejects path traversal filenames, unsupported MIME types,
  mismatched media types, oversize files and video/audio uploads until those
  modules are implemented.
- Native picker uploads validate MIME type and size in the mobile app before
  creating an upload target, then the API repeats validation before any
  `MediaAsset` can be completed.
- Cancelled or removed native uploads attempt to cancel the pending media record
  through the authenticated API. Failed uploads keep their pending media id for
  retry so the client does not create duplicate `MediaAsset` rows.
- Endpoint-specific multipart limits allow the documented media sizes without
  raising global JSON request limits. Oversize multipart and payload errors map
  to structured `FILE_TOO_LARGE` responses instead of raw infrastructure text.
- User-facing screens must not display raw storage object keys, internal API
  URLs, signed tokens, local filesystem paths or raw API error JSON.

## Security overview

TradieOS is a multi-tenant SaaS app. Security must protect customer data, business data, financial records, communications, and AI context.

## Current security implementation

- JWT authentication.
- Password hashing using `scrypt`.
- Mobile token storage using Expo SecureStore.
- Business workspace scoping through `businessId`.
- Prisma relations and query filters for tenant isolation.
- Role field on users plus active `BusinessMember` validation.
- Team membership status checks for JWT-authenticated requests.
- Audit logs for team-management actions and owner login.
- Hash-only, expiring, single-use team invitation tokens.
- Rate-limited team invitation preview and acceptance endpoints.
- Structured team-management errors that avoid leaking cross-business records.
- CORS configured for local development origins.

## JWT

JWT payload contains:

- `sub`: user ID
- `businessId`: business workspace ID

JWT rules:

- Validate on every protected route.
- Reject inactive users.
- Reject users without an active business membership.
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

## Quote security

- Quote APIs derive `businessId` only from the authenticated JWT.
- Every quote lookup, list, line-item mutation, send, acceptance and conversion
  path must filter by authenticated `businessId`.
- Client-provided quote totals are not trusted. The API recalculates subtotal,
  discount, GST, total and deposit from line items and pricing settings.
- Local send uses the console email/provider seam and must not expose production
  secrets. Real customer email delivery requires the configured email provider.
- Public customer acceptance tokens are a future seam. The current foundation
  supports authorised office-user acceptance metadata and does not expose
  unauthenticated internal quote APIs.
- Quote revisions freeze customer-facing versions and prevent accepted/sent
  versions from being silently overwritten.

## Role-based access

Current roles:

- OWNER
- ADMIN
- OFFICE_MANAGER
- SCHEDULER
- TECHNICIAN
- ACCOUNTANT
- SALES
- READ_ONLY
- STAFF legacy compatibility role

Role checks must be enforced in API guards and services.

## Audit logs

Audit logs record:

- user ID
- business ID
- action
- entity type
- entity ID
- timestamp
- metadata for sensitive changes

Current logged actions:

- INVITE_CREATED
- INVITE_VIEWED
- INVITE_RESENT
- INVITE_CANCELLED
- INVITE_ACCEPTED
- MEMBER_ACTIVATED
- ROLE_CHANGED
- MEMBER_SUSPENDED
- MEMBER_REACTIVATED
- MEMBER_REMOVED
- OWNER_LOGIN

## Team invitation security

Team invitation acceptance is a public flow, so it must not expose tenant data beyond the invited business name, invited email, assigned role, expiry, and invitation state for a valid token. The raw token is shown only in the invite URL, stored only as a hash, expires after 7 days by default, and is invalidated after successful acceptance.

Acceptance must be transactional: create or link the user, activate the existing `BusinessMember`, clear the invite token hash, set `joinedAt` and `inviteAcceptedAt`, and write audit logs together. Invited users must not create a new business, enter ABN/GST details, or choose a workspace during this flow.

Normal team invites must not default to owner access. Only an existing owner can invite or assign another owner. Admins cannot invite, change, suspend, delete, or otherwise manage owner members.

Future audit logs should also record AI action confirmation metadata.

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
