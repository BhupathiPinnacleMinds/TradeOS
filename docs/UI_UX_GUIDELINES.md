# UI/UX Guidelines

## Product feel

TradieOS should feel modern, calm, and practical. It should reduce cognitive load for busy tradies who may be using the app one-handed between jobs.

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

Customers, quotes, invoices, notifications, team and settings live under More.
Calendar carries the detailed scheduling experience, while Dashboard shows
appointment summaries only.

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

Appointment date/time copy must use business timezone utilities. Display dates
as `DD/MM/YYYY`, times as `h:mm am/pm`, time ranges as `8:00 pm – 10:00 pm`, and
timezone abbreviations from `Intl` so Melbourne/Sydney/Hobart switch between
AEST/AEDT, Adelaide switches between ACST/ACDT, Brisbane remains AEST and Perth
remains AWST.

Technician field workflow UI:

- Technician users should land on My Day instead of the owner dashboard.
- My Day should show only assigned appointment counts and field actions, not
  owner-only business metrics.
- Keep 2-3 primary actions visible on appointment cards. Put secondary work in
  Appointment Details or More menus.
- Completing an appointment must open a review flow with work completed,
  technician notes and follow-up fields before submitting.
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
