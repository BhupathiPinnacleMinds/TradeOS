# Changelog

## 2026-07-15

### Added

- Appointment & Smart Scheduling foundation.
- Multi-tenant `Appointment` and `AppointmentSequence` database models.
- Appointment API endpoints for listing, details, create, update, start, arrive, complete, cancel and technician recommendation.
- Non-AI scheduling recommendation service using working hours and existing appointment conflicts.
- Calendar tab with day, week, month and agenda appointment views.
- Appointment Details screen with customer/job context, maps/call/SMS shortcuts, status actions and basic reschedule action.
- Appointment availability API and conflict detection for overlapping technicians and default business working hours.
- Owner conflict override support for intentional scheduling exceptions.
- Shared appointment status colours and `RESCHEDULED` appointment status.
- Quick customer creation during job creation.
- Job details appointments section and combined job/appointment timeline.
- Dashboard appointment summaries for today’s appointments, next appointment, late appointments and upcoming appointments today.
- Calendar UX polish with dismissible jump-to-date modal, expandable filter summary with chevrons, status-aware appointment quick actions and blocking mutation feedback.
- Shared appointment quick-action rules so Calendar cards and Appointment Details use the same status, permission, phone and address logic.
- Appointment visit-location snapshots with customer-site, customer-default and manual one-off address sources.
- Appointment form Location and Review sections with searchable customer selection, manual Australian address validation and optional save-as-service-site behaviour.
- Appointment reassignment API with assignment-only updates, technician workload/recommendation options, conflict checks, owner/admin override support, audit timeline entries and development notification stubs.
- Mobile Reassign Appointment screen with appointment summary, recommended technician, availability indicators, conflict warning, confirmation prompt and success toast.

### Changed

- Dashboard summary now includes appointment-based scheduling metrics while keeping existing job counts.
- Bottom navigation now uses Dashboard, Calendar, Jobs, Tori and More.
- Customers moved under More.
- Dashboard keeps appointment detail lists in Calendar and shows only scheduling summaries.
- Job details now treats appointments as the future-ready scheduling layer.
- Completed, cancelled and no-show appointments no longer show invalid workflow actions such as Start or Complete.
- Calendar Previous and Next navigation now moves by the active view period: day, week, month or a documented seven-day agenda range.
- Same-record rescheduling keeps the active appointment in `SCHEDULED` or `CONFIRMED` and records `APPOINTMENT_RESCHEDULED` in audit metadata instead of leaving active visits in `RESCHEDULED`.
- Calendar, Appointment Details and Job Details now expose Reassign Technician entry points and refresh appointment data after returning from reassignment.

## 2026-07-14

### Added

- Complete Job Management module with tenant-scoped job CRUD, archive/restore, status updates, assignment, pagination, filters and per-business job numbers.
- Mobile Jobs list, Job Details and New/Edit Job flows with quick actions, contact buttons, pull-to-refresh and future-ready quotes/invoices/photos/documents sections.
- Job audit logging for create, update, assign, start, complete, cancel, hold, archive and restore actions.
- Customer Details now shows real linked jobs.
- Dashboard job metrics for today’s jobs, upcoming jobs, completed today, overdue jobs and open jobs.
- Complete Customer Management module with tenant-scoped customer CRUD, archive/restore, pagination, search, filters, sorting and structured duplicate warnings.
- CustomerSite support for multiple service locations per customer with primary-site handling and archive support.
- Mobile Customer List, Add/Edit Customer and Customer Details flows with validation, duplicate warning override, top toast feedback, centred save loaders, future-ready history sections and service-location management.
- Customer audit logging for create, update, archive, restore, customer-site create/update/archive and duplicate-warning override.
- Realistic Australian customer seed data with residential, commercial, real estate/property manager, builder, multi-site and archived examples.

### Changed

- Jobs now use `scheduledStart`, `scheduledEnd`, assignment, priority and detailed Australian address fields instead of the original placeholder schedule/address fields.
- Dashboard customer count now excludes archived customers.
- Customer model now stores display name, customer type, contact preference, Australian address fields, tags, archive metadata and normalised email/phone values for tenant-local duplicate detection.

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
