# Changelog

## 2026-07-27

### Added

- Safe media removal now archives photos/documents instead of deleting storage
  objects, with ellipsis menus on media cards, confirmation copy, archived-media
  filtering for manager roles and restore support.
- Media & Document Management foundation with tenant-scoped `MediaAsset`
  records for job photos, appointment evidence and customer/job documents.
- Storage provider abstraction with local development storage and a production
  S3-compatible adapter seam.
- Media API endpoints for upload targets, local uploads, completion, listing,
  preview/download, metadata update, archive and restore.
- Native mobile evidence capture with camera photos, photo-library selection,
  document picker uploads, pre-upload review, per-file categories, progress,
  retry and cancel handling through the existing Media API.
- Demo seed media including before/after photos, compliance certificate,
  customer plan and receipt placeholders.
- Mobile media evidence flow, secure file preview screen and media sections on
  Job Details, Appointment Details, Customer Details and My Day.

### Security

- Media archive/restore is API-enforced by business, role, uploader ownership,
  protected category and technician correction window. Technician removal is
  limited to their own recent ordinary photos on assigned work.
- Media API responses do not expose raw object keys.
- Technician, accountant, read-only and management role permissions are enforced
  on media upload/view/update/archive operations.
- Protected media files now open through authenticated in-app cache downloads
  rather than direct Safari/browser API URLs.

### Fixed

- Media-card ellipsis menus now measure the tapped button and render an
  anchored, safe-area-clamped menu instead of floating near the top of the
  screen.
- Media-card ellipsis menus now open reliably even when native measurement is
  delayed or unavailable on iPhone/Expo Go, using a safe fallback while logging
  development diagnostics.
- iPhone media-card ellipsis actions now use native `ActionSheetIOS` with
  polished View photo/document, Remove photo/document and Cancel actions,
  avoiding the fragile custom popover path.
- Removed temporary media-menu debug UI, compacted generated filenames, preferred
  captions/category labels in media menus/cards and fixed photo/document count
  pluralisation.
- My Day greeting now uses the authenticated business timezone and updates on
  screen focus/app foreground, so afternoon and evening users no longer see a
  hardcoded morning greeting.
- Add Evidence now dismisses its action menu before launching the native
  camera, photo library or document picker, preventing iOS modal timing from
  swallowing picker launches or leaving the screen unresponsive.
- Real camera, photo-library and document uploads now use binary multipart
  upload instead of Base64 JSON, so normal evidence photos do not hit JSON body
  parser limits.
- Media upload size failures now map to friendly `FILE_TOO_LARGE` UI/API
  messages, and retry reuses the pending media row instead of creating
  duplicate upload records.
- Document picker handling now follows the installed Expo result shape and uses
  stricter post-selection validation with development-only diagnostics.
- Normalised media access paths so local upload, preview, file and download URLs
  never duplicate the `/api` prefix.
- Media Viewer no longer renders raw internal URLs and now shows real secured
  image previews when available.
- Appointment Details media cards now show thumbnails, compact metadata and
  shared category/type labels instead of generic placeholders.
- Centred media action button labels and removed internal future-scheduling copy
  from user-facing appointment screens.
- Corrected demo seed timestamp insertion so Sydney demo appointments display
  during business hours instead of evening times.

## 2026-07-24

### Added

- Business timezone foundation with `Australia/Melbourne` as the default
  workspace timezone and shared date/time helpers for business-local display.
- Local demo login accounts for every supported role: owner, admin, office
  manager, scheduler, technician, accountant, sales and read-only.
- `docs/LOCAL_TEST_ACCOUNTS.md` with local-only credentials, landing screens,
  permitted modules, blocked modules and role-specific seeded demo data.
- Role-based API permission regression coverage for customers, jobs,
  appointments and team-management endpoints.
- Mobile role navigation regression coverage for visible tabs, hidden screens,
  management action visibility and safe forbidden-route fallbacks.

### Changed

- Appointment, job, dashboard, dispatcher, My Day and scheduling calculations now
  derive business-day ranges and working-hour checks from the business timezone
  while continuing to store timestamps in UTC.
- Demo appointment seed data now uses realistic tradie business-hour slots with
  travel gaps instead of late evening appointments.
- Demo seed data now activates Scheduler and includes Admin, Accountant, Sales
  and Read Only users in Demo Tradie Co using the existing hashed local demo
  password flow.
- Mobile role navigation is documented as a role-aware matrix rather than one
  global tab layout.
- Technician My Day now separates Current/Next appointment, Later today and
  Completed today without duplicating appointments across sections.
- My Day summary counts now use consistent business-timezone appointment
  sections: completed counts only `COMPLETED`, remaining counts active workflow
  statuses and urgent counts only active `URGENT` priority appointments.
- My Day appointment cards now use compact field-work actions with no more than
  two visible buttons.

## 2026-07-15

### Added

- Technician Field Workflow with `My Day`, assigned appointment counts, next
  appointment, start travel, arrived, start work and completion review.
- Tenant-scoped `AppointmentWorkLog` model for technician notes, work completed
  summaries and follow-up flags.
- `GET /appointments/my-day`, `POST /appointments/:id/start-travel` and
  `PATCH /appointments/:id/work-log` API support.
- Mobile My Day screen for technician users, with owner access from More.
- Completion review modal on Appointment Details that requires work completed
  before closing an appointment.
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
- Dispatcher View API and mobile board with technician workload cards, derived current status, unassigned appointments, smart recommendations, dispatcher search/filters and quick action hooks for future drag-and-drop scheduling.
- Dashboard dispatcher metrics for technicians working, available technicians and unassigned appointments.
- Dispatcher UX polish with one vertical board container, resilient horizontal filter chips, selected-date controls, refined loading/error/empty states, and canonical appointment creation through `AppointmentForm`.

### Changed

- Dashboard summary now includes appointment-based scheduling metrics while keeping existing job counts.
- Calendar now has top tabs for Calendar, Dispatcher and Today while keeping Calendar as the default scheduling view.
- Bottom navigation now uses Dashboard, Calendar, Jobs, Tori and More.
- Customers moved under More.
- Dashboard keeps appointment detail lists in Calendar and shows only scheduling summaries.
- Job details now treats appointments as the future-ready scheduling layer.
- Completed, cancelled and no-show appointments no longer show invalid workflow actions such as Start or Complete.
- Calendar Previous and Next navigation now moves by the active view period: day, week, month or a documented seven-day agenda range.
- Same-record rescheduling keeps the active appointment in `SCHEDULED` or `CONFIRMED` and records `APPOINTMENT_RESCHEDULED` in audit metadata instead of leaving active visits in `RESCHEDULED`.
- Calendar, Appointment Details and Job Details now expose Reassign Technician entry points and refresh appointment data after returning from reassignment.
- Dispatcher now uses the floating `+` button as the primary appointment creation action and removes confusing customer-facing travel placeholder copy.
- Appointment Details now shows reassignment only once as `Reassign Technician`, with secondary actions moved into a More menu according to status and permissions.
- Appointment Form no longer auto-selects the first customer for global Calendar/Dispatcher creation. Customer, site, job and location prefill now only happens from explicit navigation context.
- Added shared business timezone/date formatting utilities and wired Dashboard, Dispatcher, Calendar, Appointment Form, Appointment Details and Job Details appointment displays to Australian business timezone formatting.
- Business registration now records an IANA Australian timezone, defaulting from business state with an owner-selectable timezone option.

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
