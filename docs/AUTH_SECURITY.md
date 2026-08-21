# Auth Security

TradieOS private-beta authentication uses short-lived JWT access tokens plus a
durable user-level revocation version.

## Login and JWT validation

- Login returns a JWT access token and the user/business profile.
- JWTs expire after 12 hours.
- JWT payloads include `sub`, `businessId` and `authVersion`.
- Every authenticated API request reloads the user and active business
  membership from PostgreSQL.
- A request is rejected if the user is inactive, the membership is not `ACTIVE`,
  or the token `authVersion` does not match the current `User.authVersion`.

## Logout semantics

Normal logout is local-device logout. The mobile app deletes the stored JWT from
SecureStore, or localStorage on web.

Because TradieOS does not yet use refresh tokens or per-device server-side
session records, normal logout does not revoke an already-issued stateless JWT
on the server.

Use `POST /api/auth/sign-out-all-devices` when server-side invalidation is
required. That endpoint increments `User.authVersion`, causing all previously
issued JWTs for the user to fail validation.

## Password reset

Password reset is intentionally account-enumeration safe.

1. `POST /api/auth/forgot-password` accepts an email address.
2. The response is always:
   `"If an account exists, password reset instructions have been sent."`
3. If an active matching user exists, the API generates a long random token.
4. The raw token is sent only through the configured email provider.
5. The database stores only the SHA-256 token hash, expiry and lifecycle
   timestamps.
6. `POST /api/auth/reset-password` validates the raw token by hashing it and
   matching the stored hash.
7. A successful reset marks the token used, revokes other outstanding reset
   tokens for that user, updates the scrypt password hash and increments
   `User.authVersion`.

Reset tokens are single-use and expire according to
`PASSWORD_RESET_TOKEN_TTL_MINUTES` (default 60).

## Password change

Authenticated password change requires the current password and a valid new
password. Successful change updates the scrypt password hash, revokes
outstanding reset tokens and increments `User.authVersion`.

## Team suspension and removal

Suspending, reactivating or removing a member increments the linked
`User.authVersion` when a linked user exists. Suspension/removal also prevents
access through the existing `isActive` and `BusinessMember.status` checks, so a
staff user cannot continue working until JWT expiry.

## Email delivery

Password reset email uses the existing `EmailProvider` seam:

- local development: console provider logs email metadata with the reset token
  redacted;
- production: Resend provider when `EMAIL_PROVIDER=resend`,
  `RESEND_API_KEY` and `EMAIL_FROM_ADDRESS` are configured.

Production reset URLs must use HTTPS. Configure `APP_RESET_PASSWORD_URL`; if it
is omitted, the API falls back to `APP_PUBLIC_URL`.

## Rate limiting

The following endpoints use the strict auth rate-limit policy:

- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`
- `POST /api/auth/change-password`
- `POST /api/auth/sign-out-all-devices`

Rate limiting must not reveal whether a reset email belongs to an account.

## Logging and redaction

Structured auth events may include safe categories such as:

- `password_reset_requested`
- `password_reset_completed`
- `password_reset_failed`
- `password_change_completed`
- `sessions_revoked`

Never log raw reset tokens, passwords, password hashes, JWTs, authorization
headers or provider secrets.

## Current limitations

- No refresh tokens.
- No per-device server-side session list.
- No MFA.
- No admin-initiated password reset workflow.
- Reset completion UX is intentionally minimal for private beta and can be
  polished into a richer web/deep-link flow later.
