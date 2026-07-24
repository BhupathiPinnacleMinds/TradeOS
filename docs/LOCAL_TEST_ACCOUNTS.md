# Local Test Accounts

LOCAL DEVELOPMENT ONLY — NEVER USE IN PRODUCTION.

These accounts are created by `pnpm db:seed` for the local Demo Tradie Co
workspace only. They all use the shared local password `password123`, stored in
the database with the existing salted `scrypt` password hashing function. The
plaintext password must never be stored in the database or reused for production
accounts.

| Role           | Email                          | Local password | Landing screen | Permitted modules                                                                                    | Blocked modules                                                                                                  |
| -------------- | ------------------------------ | -------------- | -------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| OWNER          | `owner@demo-tradieos.com`      | `password123`  | Dashboard      | Dashboard, Calendar, Dispatcher, Jobs, Customers, Tori, Team, Settings, Quotes/Invoices placeholders | None in current local foundation                                                                                 |
| ADMIN          | `admin@demo-tradieos.com`      | `password123`  | Dashboard      | Dashboard, Calendar, Dispatcher, Jobs, Customers, Tori, Team, Settings, Quotes/Invoices placeholders | Owner transfer/delete-business future controls                                                                   |
| OFFICE_MANAGER | `alex@demo-tradieos.com`       | `password123`  | Dashboard      | Dashboard, Calendar, Dispatcher, Jobs, Customers, Tori, Settings, Quotes/Invoices placeholders       | Team management, owner-only billing/subscription controls                                                        |
| SCHEDULER      | `scheduler@demo-tradieos.com`  | `password123`  | Dashboard      | Dashboard, Calendar, Dispatcher, Jobs, Customers, Tori, Notifications                                | Team management, business settings, invoices, owner-only financial/settings screens                              |
| TECHNICIAN     | `mia@demo-tradieos.com`        | `password123`  | My Day         | My Day, assigned Calendar appointments, Tori, Notifications, assigned appointment details            | Add Customer, Add Job, Add Appointment, Team, Dispatcher, Business Settings, Customer Management, Job Management |
| ACCOUNTANT     | `accountant@demo-tradieos.com` | `password123`  | Dashboard      | Dashboard, Tori, More, invoices placeholder, read-compatible financial seed data                     | Scheduling management, appointment creation, team management, business settings                                  |
| SALES          | `sales@demo-tradieos.com`      | `password123`  | Dashboard      | Dashboard, Customers, Quotes placeholder, Tori, Notifications                                        | Jobs management, appointments management, invoices, payments, reports, settings, team                            |
| READ_ONLY      | `readonly@demo-tradieos.com`   | `password123`  | Dashboard      | Dashboard, Calendar, read-only customer/job/calendar data, More                                      | All create/edit/delete forms and management actions                                                              |

## Seeded role data

- Owner has `APT-2026-000007`, a confirmed appointment scheduled for seed
  “today” against Priya Sharma at `12 King Street, Parramatta NSW 2150`.
  This appointment is suitable for testing
  `CONFIRMED → ON_THE_WAY → ARRIVED → IN_PROGRESS → COMPLETED`.
- Technician Mia keeps multiple existing assigned appointments:
  `APT-2026-000001`, `APT-2026-000002`, `APT-2026-000005`, and
  `APT-2026-000006`.
- Scheduler testing uses the dispatcher view, existing technician workload, and
  unassigned appointment `APT-2026-000004`.
- Accountant testing uses the existing invoice/payment-compatible seed state and
  does not fabricate unsupported accounting module behaviour.
- Sales testing uses existing customers and quote placeholder access only.
- Read-only testing uses existing customer, job and calendar records without
  edit rights.

## Validation

After changing demo accounts or role visibility, run:

```bash
pnpm db:seed
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
```
