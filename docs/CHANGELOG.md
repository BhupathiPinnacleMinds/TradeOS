# Changelog

## 2026-07-10

### Added

- Team Management foundation with `BusinessMember` records, granular roles, invite tokens, member status, and member audit logs.
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
