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

The primary bottom navigation is:

- Dashboard
- Calendar
- Jobs
- Tori
- More

Customers, quotes, invoices, notifications, team and settings live under More.
Calendar carries the detailed scheduling experience, while Dashboard shows
appointment summaries only.

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

Calendar Previous and Next controls must move by the active view: one day in Day
view, one week in Week view, one calendar month in Month view, and seven days in
Agenda view. Month movement should clamp safely around month ends, leap years
and year boundaries.

Appointment forms must include a Location section before Job selection. Users
can choose a customer service site, use the customer default address, or enter a
manual one-off appointment address. Manual addresses require Australian state
and four-digit postcode validation and should show a readable location summary
before Save.

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
