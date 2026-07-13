# Changelog

## 2026-07-12

### Added

- Team invitation acceptance flow with hash-only invite tokens, 7-day expiry, cancellation, resend, public preview, and transactional acceptance.
- Mobile Accept Invitation screen for invited users to join an existing business without creating a new workspace.
- Team screen invited-member actions for resend, copy link, and cancel, plus compact action menus for active members.
- Audit logging for invite viewed, resent, cancelled, accepted, and member activated events.
- Team management polish with validated invite names, structured API error codes, duplicate invite/member handling, overlay action menus, confirmation modals, role-change modal, status filters, result counts, and a Team Member Profile screen.
- Team invitation email provider architecture with console fallback for local development, Resend-ready delivery, delivery status tracking, and audit logs for invite email success/failure.
- Mobile global toast feedback and loading states for team invite, resend, copy link, role change, suspend/reactivate, delete, and cancel-invite actions.
- Team list state fixes so cancelled invites disappear immediately, result counts refresh after mutations, duplicate invite conflicts show inline email errors, and blocking mutations use a centred loading overlay.

### Changed

- Business member invitation storage now uses `inviteTokenHash`, `inviteExpiresAt`, `inviteAcceptedAt`, and `inviteCancelledAt` instead of raw invite tokens.
- Pending invited members now store `invitedFirstName` and `invitedLastName` on `BusinessMember` without creating a user account before acceptance.
- Invite links are only exposed by API responses outside production; production invitation delivery is handled through the configured email provider.
- Cancelled invite rows are retained for audit history but excluded from normal `GET /members` responses and Team filters.

## 2026-07-10

### Added

- Team Management foundation with `BusinessMember` records, granular roles, member status, and member audit logs.
- Audit log table for team actions and future high-risk module events.
- Mobile Team screen with search, role filtering, role badges, invite URL display, and member action controls.

### Changed

- JWT validation now requires an active business membership in addition to an active user.

## 2026-07-08

### Added

- Master `/docs` documentation structure.
- Product Requirements Document.
- Product vision.
- Architecture documentation.
- Database documentation.
- API standards.
- Tori AI philosophy and safety rules.
- Security documentation.
- Roles and permissions model.
- UI/UX guidelines.
- Coding standards.
- Deployment notes.
- Roadmap.

## Existing project foundation

Prior implementation includes:

- Monorepo scaffold.
- Expo React Native mobile app.
- NestJS API.
- PostgreSQL with Prisma.
- Multi-tenant business workspace.
- JWT authentication.
- Register/login screens.
- Secure mobile token storage.
- Seeded demo business.
- Database-backed dashboard summary.
