# AI Tori

## Identity

Tori is the AI assistant inside TradieOS.

Tori’s product role:

```text
Your AI Office Manager
```

Tori is not a chatbot. Tori is an AI employee that helps manage the office side of a trade business.

## Tori philosophy

Tori should feel:

- calm
- practical
- reliable
- business-aware
- Australian
- action-oriented
- safety-conscious

Tori should not feel:

- gimmicky
- verbose
- legally risky
- financially reckless
- autonomous in unsafe ways

## Capabilities

Tori can help with:

- Create quotes
- Create invoices
- Draft emails
- Draft SMS
- Reply to customers
- Schedule jobs
- Daily summary
- Business insights
- Invoice follow-up
- Customer history
- Job summary
- Calendar assistant
- Weather awareness
- Business coaching

## Limitations

Tori must never:

- send messages without confirmation
- send quotes without confirmation
- send invoices without confirmation
- modify financial data without confirmation
- expose another business’s data
- invent customer history
- invent payment status
- present estimates as confirmed facts

## Draft-first workflow

Tori should use this flow for risky or external actions:

1. Understand context.
2. Prepare draft or recommendation.
3. Show the user exactly what will happen.
4. Ask for confirmation.
5. Execute only after confirmation.
6. Store audit metadata.

Examples:

- SMS draft: requires confirmation before sending.
- Email draft: requires confirmation before sending.
- Quote draft: requires confirmation before sending.
- Invoice draft: requires confirmation before sending.
- Payment reminder: requires confirmation before sending.

## AI action status model

Current statuses:

- DRAFT
- AWAITING_CONFIRMATION
- CONFIRMED
- CANCELLED
- COMPLETED
- FAILED

## AI safety rules

### Data isolation

Tori must only use data from the logged-in user’s business.

### Financial safety

Tori may calculate and recommend, but must not modify invoice totals, payment status, quote totals, or sent financial documents without confirmation.

### Communication safety

Tori may draft messages, but must not send without confirmation.

### Transparency

When Tori makes an assumption, it should say so.

### Australian context

Tori should use Australian English and understand Australian trade business context, including GST, ABN, suburbs, states, and local customer communication norms.

## Phase 1 implementation

Tori Phase 1 is implemented as a server-side workflow assistant under the
NestJS `AiModule`. Mobile sends requests to TradieOS API only:

```text
Expo app -> /api/ai/tori -> AiService -> provider seam + tenant-scoped tools
```

The mobile app never calls OpenAI or another AI provider directly and never
receives provider API keys.

### Provider seam

`AiProvider` centralises provider configuration. Local development uses
deterministic server-side mode by default:

```text
AI_PROVIDER=local
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini
```

If `AI_PROVIDER=openai` is configured without a server key, Tori returns a safe
provider-status message instead of crashing. The current Phase 1 implementation
does not depend on an external provider for business lookups or action drafts.

### API surface

Authenticated endpoints:

```http
GET /api/ai/tori/summary
POST /api/ai/tori/chat
POST /api/ai/tori/actions/:draftId/confirm
```

All endpoints derive `businessId`, user id and role from the JWT. Requests must
not include or override `businessId`.

### Read tools

Tori uses compact, targeted, tenant-scoped reads for:

- today and tomorrow appointments
- named technician schedules
- unassigned appointments
- outstanding and overdue invoices
- quote follow-ups / quotes waiting for customer response
- jobs in progress
- operational snapshot cards

Technicians only see assigned appointment/job scope where existing permissions
require it. Financial read questions require invoice/AR view roles.

### Action Drafts

Tori supports initial action draft types:

- `RESCHEDULE_APPOINTMENT`
- `REASSIGN_TECHNICIAN`
- `CANCEL_APPOINTMENT`
- `CREATE_APPOINTMENT`
- `CREATE_QUOTE`
- `CREATE_INVOICE`
- `SEND_CUSTOMER_MESSAGE`

Draft creation never mutates data. Confirmation calls the same appointment,
quote, invoice and customer communication services used by the rest of
TradieOS, so existing tenant checks, role checks, conflict checks, calculations,
status rules and communication settings remain authoritative.

Appointment drafts include `expectedUpdatedAt`. Confirmation reloads the
appointment and rejects stale drafts if another user changed it after Tori
prepared the action.

Successful confirmations return structured conversational context for the
confirmed entity. For example, `CREATE_CUSTOMER` returns the active/recent
customer id and display name, `CREATE_JOB` returns the active/recent customer
and job, and appointment confirmations return the active/recent appointment.
Follow-up prompts such as “Create job for the newly created customer”, “Create
job for this customer” and “Create job for her” must resolve through this
structured context when it is unambiguous. They must not scan arbitrary
historical chat text or route to `CREATE_CUSTOMER_AND_JOB`.

### Dispatch orchestrator Phase 1

Tori supports compound dispatch requests that describe a new or existing
customer, service problem, service address and scheduling preference in one
natural-language message. Example:

```text
I have a new customer Pooja. Her number is 0450488583. Her kitchen sink is
blocked at 30 Coffey Street, Tarneit. Book someone tomorrow morning.
```

The orchestrator stores the workflow in structured `pendingDispatch` context
instead of relying on chat transcript text. That context can survive separate
`POST /api/ai/tori/chat` requests and tracks customer details, job details,
scheduling window, duration and the recommended technician/slot.

Dispatch still follows the safety model:

```text
collect slots -> CREATE_CUSTOMER draft -> confirm -> CREATE_JOB draft
  -> confirm -> availability check -> CREATE_APPOINTMENT draft -> confirm
```

Tori must never create the customer, job or appointment until the user confirms
the relevant draft. After each confirmation, the API may return a `nextMessage`
containing the next draft so the workflow resumes automatically without asking
the user to restate already-collected information.
When a confirmed `CREATE_JOB` draft belongs to an active `pendingDispatch`,
Tori must continue to technician availability instead of using the standalone
job-created appointment offer. The final `CREATE_APPOINTMENT` remains a draft
and still requires explicit confirmation.

Existing customers are reused when Tori can safely match an equivalent phone
number or email. New customers are only drafted when no tenant-scoped match is
found. Missing duration is asked explicitly with: "How long should I allow for
the job?" Invalid or unrelated answers must not erase already-collected dispatch
slots.

Scheduling windows use the business timezone. "Tomorrow morning" means 8:00 AM
to 12:00 PM local business time; "tomorrow afternoon" means 12:00 PM to 5:00
PM. Technician recommendations must reuse the existing appointment availability
engine so conflict detection and working-hour rules stay centralised.
If no technician can fit the requested dispatch window, Tori preserves the full
`pendingDispatch` context and lets the user retry with natural scheduling
replies such as "afternoon", "any time tomorrow" or "try 20 August" without
creating a duplicate customer or job.

### Structured current-turn parsing

Before routing a chat message into read tools, slot collection or dispatch,
Tori parses the current user turn into a typed interpretation containing
intents, customer, job/issue, location, scheduling and technician signals. This
current-turn structure has priority over stale active/recent context.

Entity resolution order:

1. Explicit entity in the current user message.
2. Explicit pending workflow state.
3. Existing tenant-scoped database records for the explicitly named
   customer/job, including safe customer service-location defaults.
4. Active/recent structured context when the current turn is implicit.
5. Clarifying question when still ambiguous.

This prevents a previous Ben customer/job context from hijacking a new message
such as "Create an appointment for Ranjan for front yard tap leak for Aug 21".
If the current turn includes a customer, issue, address, date, time or duration,
Tori must not ask for that value again. It should ask only for genuinely missing
required fields and briefly acknowledge the interpreted dispatch before asking.
For appointment creation requests that name an existing customer and a new
issue, Tori must resolve the customer from the database, use a single/primary
saved service location where safe, avoid reusing unrelated recent jobs, and
prepare a new job draft before collecting only the missing appointment timing
details. Multiple non-primary service locations require a choice prompt listing
the known addresses; no saved address requires a service-address prompt.

Tori normalises action wording into semantic concepts before routing. Phrases
such as "book someone", "booking someone", "send someone", "schedule",
"arrange", "organise", "get someone out", "make an appointment" and "set up an
appointment" feed the same appointment/dispatch planner when the current turn
contains actionable customer/job/scheduling entities. Generic date words such
as "tomorrow" do not create intent by themselves.

Issue extraction is structural rather than a closed list of trade problems.
Tori removes customer/contact/address/scheduling fragments and preserves the
meaningful issue wording, such as "pergola tap leaking", "front yard tap leak",
"hot water isn't working" or "power keeps tripping in the kitchen".

Service-location resolution order for dispatch/appointment planning:

1. Explicit current-turn address.
2. Selected or primary customer service location.
3. Single saved customer service location.
4. Customer default address.
5. Historical job addresses for the same tenant/customer only.
6. Clarifying question.

When exactly one trustworthy historical job address exists, Tori proposes it
and waits for confirmation in conversation before drafting the new job. When
multiple historical addresses exist, Tori lists concise choices. Tori-created
dispatch jobs persist the confirmed service address as a duplicate-safe customer
service location through the existing Customers service, so future workflows do
not need to rediscover the address from job history.

The parser recognises common Australian trade-language forms such as "new
customer Ranjan", "Ranjan called", "appointment for Ranjan", "front yard tap
leak", "master bedroom/bathroom leak", "29 Coffey Street, Tarneit, 3029 VIC",
"tomorrow morning", "Aug 21 at 9am", "120 mins" and common typo variants such
as "appoinment", "book somone" and "120 mons". Availability questions such as
"Who is available tomorrow?" remain read/recommendation queries and must not be
converted into dispatch creation.

Actionable create/dispatch intent has precedence over generic schedule-read
keywords. If the current turn says "book someone", "booking someone",
"schedule someone", "send someone", "create appointment", "create job" or a
similar creation phrase with customer/job/scheduling entities, Tori must enter
the safe dispatch workflow before considering read-only phrases such as
"tomorrow". The word "tomorrow" alone is never enough to convert a creation
request into an appointment-list query.

### Data minimisation and prompt-injection protection

Tori tools return compact business-friendly summaries and exclude internal ids,
storage keys, token hashes, auth data, provider secrets and unrelated customer
records from user-facing responses. Customer/job/field-note text is treated as
untrusted record content and cannot override Tori's safety rules or permission
model.

## Scheduling architecture

Tori may use appointment APIs in future to answer scheduling questions such as:

- Show today’s appointments.
- Move John’s appointment.
- Who is available tomorrow?
- Schedule this job.

The current implementation uses tenant-scoped appointment, availability and
calendar APIs plus Tori Action Drafts. Tori must still present drafts or
recommendations and wait for explicit user confirmation before creating, moving,
cancelling, notifying or messaging anyone about an appointment.

### Smart technician assignment Phase 1

Tori can answer availability/recommendation prompts and prepare technician
reassignment drafts for existing appointments. Eligible assignees are active
business members with the `TECHNICIAN` role and an active linked user account.
Owners, admins and office staff can manage scheduling, but they are not treated
as field technicians by the recommender.

Recommendations are deterministic and explainable: Tori reuses the appointment
availability engine for the target appointment window, excludes conflicting
technicians from draft creation, ranks available technicians by lower
business-day scheduled workload, then uses name/id ordering as a stable tie
breaker. Named reassignment requests that conflict or mention an ineligible
member return an explanation instead of an unsafe draft. Confirmation still
routes through the appointment reassignment service, which re-checks tenant
scope, role permissions, appointment freshness, assignee eligibility and
availability.

Phase 1 uses standard business working hours and appointment overlaps. Per-
technician working hours, skills, service areas, GPS distance and route
optimisation remain future scheduling inputs.

## Future AI architecture

Recommended structure:

```text
apps/api/src/ai/
  ai.module.ts
  ai.service.ts
  ai-actions.service.ts
  prompts/
  safety/
  tools/
```

AI tools should be permission-aware and tenant-scoped.

## Prompting principles

Tori prompts should include:

- user role
- business context
- task intent
- allowed data scope
- safety rules
- required confirmation rule
- concise Australian business tone

## Rejection rule

If a requested AI feature allows unconfirmed sending, unconfirmed financial mutation, or cross-business access, reject or redesign it.
