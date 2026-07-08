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

- Background: soft green-grey
- Card: white
- Primary: trade green
- Ink: dark green/black
- Muted: grey-green
- Tori: purple
- Warning: amber/brown
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
