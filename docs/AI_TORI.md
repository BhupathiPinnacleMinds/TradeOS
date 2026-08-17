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
