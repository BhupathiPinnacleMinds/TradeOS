# UI/UX Guidelines

## Tori UX

- Tori is an operational assistant, not a generic chat clone.
- The Tori tab should show a compact header, safety note, operational snapshot,
  suggested prompts, chat history and one input.
- Tori responses should be concise, scannable and action-oriented.
- Action Draft cards must show exactly what will happen before confirmation:
  title, description, proposed changes, warnings, Cancel and Confirm.
- Cancel must never mutate data. Confirm must disable while processing to avoid
  duplicate mutations.
- Tori must never imply a quote, invoice, SMS or email was sent unless the user
  explicitly confirmed and the underlying API completed the action.
- Provider/local-mode status can be shown quietly, but it should not dominate
  the screen.
- Empty and zero-result states should be plain language:
  "I couldn't find any overdue invoices" rather than fake records or raw API
  details.

## Customer communications UX

- Customer Details shows a compact Communications section with channel, type,
  status, date/time and a short customer-safe preview.
- Office users may use Send message from Customer Details. Phase 1 records the
  communication through the local-safe provider; it must not imply a real vendor
  delivered SMS/email.
- Communication Settings belongs in Settings as a compact defaults section. Do
  not build a complex workflow-builder UI for Phase 1.
- Appointment, Quote and Invoice detail screens may show compact communication
  history/status, but lifecycle buttons must stay focused on the primary entity.
- Failed communication states should be clear and calm. Do not expose raw
  provider exceptions, public-token hashes, database IDs or internal notes.

## Quotes UX

- Quotes use list, detail and multi-step form screens.
- The quote form stays split into scope, line items, GST/terms and review steps
  so it does not become one long screen.
- Mobile totals update immediately using the shared quote calculation helper;
  the API remains authoritative after save.
- Quote cards show quote number, customer, status, total, expiry and linked job
  when present. Detailed lifecycle actions belong on Quote Details.
- Empty, error and loading states must never fall back to fake quote data.
- Quote creation entry points are More -> Quotes, Customer Details, Job Details

## Invoices UX

- Invoices use list, detail and multi-step draft form screens, aligned with the
  Quotes architecture.
- Invoice creation entry points are More -> Invoices, Customer Details and Job
  Details. Creating from Job Details pre-populates customer, job and source quote
  context where available.
- When opened from Job Details, the invoice Scope step should show the selected
  customer, job and source quote as an explicit scoped summary instead of a broad
  all-customer/all-job picker. This reduces accidental customer/job switching
  that would break quote/job/invoice traceability.
- The invoice form is split into Scope, Items, Terms and Review steps. It keeps
  numeric input as safe strings while editing and converts to integer cents only
  when calculating or saving.
- Invoice cards show invoice number, status, customer, total, balance due, due
  date and linked job. Overdue invoices should be highlighted clearly but not
  alarmingly.
- Invoice Details owns lifecycle actions. Draft invoices show Edit/Send/PDF/Void
  actions. Sent/viewed/part-paid invoices expose PDF, resend and record payment
  where permitted. Paid and void invoices are view-oriented.
- Invoice Details action buttons must be derived from
  `getInvoiceAvailableActions` so role/status/balance rules stay aligned with
  the API. Do not add inline status checks for new invoice actions when a shared
  domain helper can describe the same rule.
- Record Payment uses an explicit confirmation modal. Payments are appended and
  never silently mutate historical amounts.
- Accounts Receivable is the collection-focused view for outstanding, overdue,
  due-soon and paid invoices. Dashboard financial cards should navigate to this
  screen rather than duplicating detailed invoice lists.
- Invoice Details should show a clear paid state, a payment-history section and
  receipt actions for each payment. Receipt buttons may say `Generate receipt`
  before a receipt exists and `View receipt` after one has been generated.
- Customer Details and Job Details may show compact financial summaries, but
  detailed collection workflows belong in Accounts Receivable and Invoice
  Details.
- Public invoice pages expose customer-safe invoice, item, totals, amount-paid
  and balance-due details only. Internal notes, tenant ids, audit entries and
  storage paths must not appear in the UI.

## Media & document UX

- Job Details must show photos and documents as real sections, not future
  placeholders.
- Appointment Details must provide a clear evidence area for before/progress/
  after photos, compliance documents and receipts.
- Appointment Details media cards show real authenticated thumbnails for image
  assets, compact document cards for PDFs/documents, category badges, uploader,
  upload time and truncated filenames/captions.
- Media Viewer must never display raw API URLs, storage paths, object keys or
  signed tokens. It should show only user-facing metadata and open files through
  an authenticated in-app cache download.
- Buttons such as Add evidence, Open file, Retry and upload actions must keep
  text centred horizontally and vertically with accessible touch targets.
- My Day keeps field cards uncluttered and surfaces evidence capture only during
  active field workflow states.
- Add Evidence opens a concise native action menu: Take photo, Choose photos,
  Choose document and Cancel. Selected files are reviewed before upload with
  thumbnail/icon, filename, size, category, shared caption/notes and per-file
  status. The app must not auto-upload immediately after a picker returns.
- Native camera, photo-library and document pickers must launch only after the
  Add Evidence action menu has fully dismissed. Keep option handlers separate,
  reset pending picker state after success, cancellation, permission denial,
  error or navigation away, and never leave an invisible backdrop blocking
  future taps.
- On iOS, Add Evidence should use the native `ActionSheetIOS` selector before
  launching Expo camera, photo-library or document pickers. The launch flow must
  use a ref-based lock, a fallback launch attempt and a watchdog reset so Expo
  Go cannot leave the button stuck in an opening state.
- Upload progress should be visible per file and overall. Failed files should
  offer Retry with friendly error text, pending/uploading files should support
  Cancel where the API can cancel the upload target, and picker cancellation
  should be silent rather than shown as an error. Raw backend phrases such as
  `request entity too large`, Multer errors or stack traces must never appear in
  the mobile UI.
- Media cards use a small ellipsis menu for View, Edit details, Remove
  photo/document and Restore where permitted. Removal must show confirmation
  copy explaining that the file is hidden from normal views while audit history
  is retained. The selected card may show a loader; screens must not show a
  permanent large Delete button on every card.
- Media-card ellipsis menus must be anchored to the tapped ellipsis button using
  screen coordinates, not card-relative layout or fixed modal placement. Clamp
  menus inside the visible safe area, keep titles to one or two truncated lines,
  close the menu on outside press, action selection, navigation away and touch
  movement while open. If native anchor measurement fails or returns a zero-size
  rect, the menu must still open using a safe fallback position rather than
  silently doing nothing.
- Media-card ellipsis actions use the same anchored in-app action menu on
  iPhone, Android and web so View, Remove/Restore and Cancel labels are always
  visible. Do not show development build markers, debug toasts or raw generated
  filenames in normal media menus. Prefer captions, then friendly category
  labels, then compact filenames.
- Customer Details should show customer-level and linked job media from the
  same secured media list API.
- Tori may later summarise media metadata, but must never send customer-facing
  messages or documents without explicit user confirmation.
- Future architecture notes belong in documentation, not technician-facing
  appointment screens.

## Product feel

TradieOS should feel modern, calm, and practical. It should reduce cognitive load for busy tradies who may be using the app one-handed between jobs.

My Day greetings must use the authenticated business timezone, not device-local
or server-local time. Greeting ranges are 5:00 am-11:59 am for "Good morning",
12:00 pm-4:59 pm for "Good afternoon", 5:00 pm-9:59 pm for "Good evening" and
10:00 pm-4:59 am for "Hello". Do not show a dangling comma when the user's
first name is unavailable.

Inspirations:

- Apple: clarity, spacing, native feel
- Linear: crisp workflows and focused surfaces
- Stripe: professional SaaS trust
- ChatGPT: approachable AI interaction

## UI principles

- Mobile first.
- One-hand usage.
- Large buttons.
- Minimal screens.
- Clear hierarchy.
- Fast scanning.
- Low admin friction.
- Australian English.
- Accessibility by default.
- Dark mode ready.

## Tone

Use concise Australian English.

Prefer:

- “Today’s jobs”
- “Outstanding”
- “Log out”
- “Create workspace”
- “Tori’s daily priorities”

Avoid:

- overly technical language
- generic enterprise jargon
- long explanations in primary flows

## Design system

### Colours

Current palette:

- Background: clean slate off-white
- Card: white
- Primary: modern indigo
- Ink: deep slate
- Muted: slate grey
- Tori: violet
- Warning: amber
- Error: red

### Typography

Use strong headings and readable body text.

Guidelines:

- Large page titles.
- Bold section headers.
- 16px+ body/input text where possible.
- Avoid tiny touch targets.

### Spacing

Use generous spacing to reduce clutter.

Guidelines:

- 20–24px screen padding.
- 12–18px between related controls.
- 20px+ between sections.

### Cards

Cards should group related information:

- dashboard stats
- customer summary
- job summary
- business profile
- Tori priority

### Buttons

Primary buttons:

- full width where action is important
- strong green
- clear text

Secondary buttons:

- text or outlined
- lower visual weight

Danger buttons:

- red
- used for logout, delete, destructive actions

## Calendar navigation

The primary bottom navigation is role-aware. Users should only see screens they
can use.

| Role                                 | Bottom navigation                        |
| ------------------------------------ | ---------------------------------------- |
| Owner/Admin/Office Manager/Scheduler | Dashboard, Calendar, Jobs, Tori, More    |
| Technician                           | My Day, Calendar, Tori, More             |
| Accountant                           | Dashboard, Tori, More                    |
| Sales                                | Dashboard, Customers, Quotes, Tori, More |
| Read Only                            | Dashboard, Calendar, More                |

Customers, quotes, invoices, accounts receivable, notifications, team and
settings live under More according to role permissions. Calendar carries the
detailed scheduling experience, while Dashboard shows appointment and financial
summaries only.

Forbidden screens and actions must be hidden from navigation, cards, menus and
FABs. If a stale route or manual navigation attempt targets a forbidden screen,
redirect to the role’s permitted home without rendering that forbidden screen.

Calendar uses top tabs for `Calendar`, `Dispatcher`, and `Today`. Calendar must
remain the default tab. Dispatcher is an operational board for office staff and
tablet/desktop use; it should feel dense but scannable, with large technician
cards, workload summaries, unassigned appointments and quick actions.

Dispatcher must use a single primary vertical scroll container. Horizontal
filter chips may scroll inside the header, but they must not be wrapped in a
parent `Pressable` or nested inside another vertical scroll container. The last
chip needs right-side padding so it can scroll fully into view, and every chip
needs a clear selected state, accessibility selected state and at least a 44px
touch target.

Dispatcher appointment creation should use one clear global action: the
floating `+` button. Section-level create actions should be avoided unless they
are clearly secondary text actions. The FAB must sit above bottom navigation and
content should have enough bottom padding that appointment cards are not hidden.

Dispatcher operates one day at a time. Always show the selected date with
previous day, next day and Today controls. Creating an appointment from
Dispatcher must prefill the selected dispatcher date.

Dispatcher summaries must avoid internal placeholder wording. If travel time is
not implemented, keep travel fields internal and show customer-facing copy such
as booked time and available time only.

Calendar date jumping should use a dismissible modal or native picker overlay.
The picker must close after selection, Done, backdrop tap, Android back, and
navigation changes, and it must not permanently occupy space in the appointment
list.

Calendar filters should use a compact expandable header with an explicit
chevron and a plain-language summary such as `All technicians · All statuses`.
Expanded filters may include search, technician chips and status chips, but
collapsed filters must preserve the selected values.

Appointment card quick actions must be status-aware. Hide call actions without a
phone number, hide navigation without an address, hide workflow actions when the
user lacks permission, and never show Start or Complete on completed, cancelled
or no-show appointments. Calendar cards and Appointment Details should use the
same central quick-action rules.

Calendar appointment cards should keep the surface tidy by placing secondary
actions under `More`. The More menu may include Navigate, Call, Reassign
Technician, Reschedule, Cancel and View Details according to the same shared
permission/status rules. Reassignment should open a focused Reassign
Appointment screen that shows the current appointment summary, recommended
technician, availability/workload indicators, conflict warning and confirmation
before saving.

Dispatcher technician cards should show avatar initials, role, working hours,
derived current status, workload, completed/upcoming counts, overtime warnings
and appointment badges for priority, status, trade/type and duration. Unassigned
appointments should show a recommendation with a plain-language reason.

Calendar Previous and Next controls must move by the active view: one day in Day
view, one week in Week view, one calendar month in Month view, and seven days in
Agenda view. Month movement should clamp safely around month ends, leap years
and year boundaries.

Appointment forms must include a Location section before Job selection. Users
can choose a customer service site, use the customer default address, or enter a
manual one-off appointment address. Manual addresses require Australian state
and four-digit postcode validation and should show a readable location summary
before Save.

Appointment forms opened from global Calendar or Dispatcher creation must start
with no selected customer. Show `Search and select a customer`, a small recent
customer list, and a selected-customer summary only after the user chooses one.
Only Customer Details, Job Details, Schedule Now and future explicit actions may
prefill a customer. Changing or clearing customer must clear dependent site, job
and location state.

Appointment date/time copy must use the shared business timezone utilities.
Display examples:

- `Fri, 24 Jul 2026`
- `7:30 AM`
- `7:30 AM – 9:00 AM`
- `Today`
- `Tomorrow`
- `Yesterday`

Avoid ISO strings anywhere in the UI. Calendar, Dispatcher, Dashboard, My Day,
Appointment Details, Job Details, Notifications, Tori scheduling surfaces and
Reports must all use the same helper layer so a business sees one consistent
local time. Timezone handling must use IANA timezone names and `Intl` so
Melbourne/Sydney/Hobart switch between AEST/AEDT, Adelaide switches between
ACST/ACDT, Brisbane remains AEST and Perth remains AWST.

Seed and demo appointment examples should look like realistic tradie working
hours: `7:30 AM – 8:30 AM`, `9:00 AM – 11:00 AM`, `11:30 AM – 12:30 PM`,
`1:00 PM – 3:00 PM`, and `3:30 PM – 5:00 PM`.

Technician field workflow UI:

- Technician users should land on My Day instead of the owner dashboard.
- My Day should show only assigned appointment counts and field actions, not
  owner-only business metrics.
- My Day is organised as summary metrics, Current/Next appointment, Later today
  and Completed today. The Current/Next appointment must not be repeated in
  Later today.
- My Day appointment cards should be compact and show suburb instead of the full
  address, with time, job title, customer, priority and status visible.
- Keep no more than two actions visible on My Day appointment cards. Use short
  labels such as `Start travel`, `Arrived`, `Start work`, `Pause`, `Resume`
  and `Complete`. Put secondary work in Appointment Details or More menus.
- Appointment Details should act as the execution screen: show the appointment
  number, job title, current status, scheduled time, assigned technician, one
  status-appropriate primary action area and a timing card for travel, work,
  paused and elapsed time.
- Field notes and work-completed summaries are editable during `ARRIVED`,
  `IN_PROGRESS` and `PAUSED` states, with an explicit Save action and a discard
  warning for unsaved text.
- Completing an appointment must open a review flow with work completed,
  technician notes, follow-up fields, checklist status, customer signature and
  final duration review before submitting.
- Customer signature capture must include clear/reset controls, consent text and
  a visible saved/skipped state. Owner/Admin signature skips require a reason;
  technicians should capture the signature rather than silently bypassing it.
- Use large touch targets, pull-to-refresh, centred mutation loaders and friendly
  error messages.

### Forms

Forms should:

- use clear labels
- avoid unnecessary fields
- support mobile keyboards
- show validation errors plainly
- keep registration understandable

### Icons

Use icons only when they clarify meaning. Do not rely on icons alone.

### Loading states

Show clear loading text:

- “Loading your business dashboard...”
- “Creating workspace...”
- “Logging in...”

### Empty states

Empty states should be helpful:

- “No jobs scheduled for today.”
- “No unpaid invoices.”
- “Tori will surface priorities here.”

### Error states

Errors should explain the next step:

- “Check the API is running and your phone/browser can reach it.”
- “Invalid email or password.”

## Accessibility

Requirements:

- Use accessible button roles.
- Maintain contrast.
- Use readable font sizes.
- Avoid colour-only meaning.
- Support screen reader labels where needed.

## Dark mode

The app should be dark-mode ready, but dark mode does not need to be built before core workflows are stable.
