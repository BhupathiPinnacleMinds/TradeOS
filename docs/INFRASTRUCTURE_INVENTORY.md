# TradieOS Infrastructure Inventory

This file contains non-secret infrastructure metadata for TradieOS staging and
future production environments.

Credentials must be kept outside Git in the relevant provider secret manager,
deployment environment variables or the project owner's password manager.

This file is safe to commit to GitHub only when it contains non-secret metadata.
Never add passwords, API keys, database URLs, private tokens, access keys,
signing credentials or screenshots containing secrets.

## Staging environment

Environment: `STAGING`

| Provider | Resource   | Resource name       | Purpose                                      | Region                     | Plan                                            | Storage                                                | Approx monthly cost | Status                         | Created date | Notes                                                                                                                                                                                 |
| -------- | ---------- | ------------------- | -------------------------------------------- | -------------------------- | ----------------------------------------------- | ------------------------------------------------------ | ------------------- | ------------------------------ | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Render   | Workspace  | TradieOS            | TradieOS staging hosting workspace           | Global/account-level       | TBD                                             | N/A                                                    | TBD                 | Active/account selected        | TBD          | Account owner: Project owner. Login email stored securely outside repository.                                                                                                         |
| Render   | PostgreSQL | tradieos-staging-db | Staging PostgreSQL database for TradieOS API | Singapore (Southeast Asia) | Basic-256mb, PostgreSQL 16, 256 MB RAM, 0.1 CPU | 1 GB, autoscaling disabled, high availability disabled | USD $6.30/month     | Being provisioned / configured | 2026-08-21   | Database name: `tradieos_staging`. Database user: `tradieos_staging`. Credential location: Render environment/private connection configuration. Do not write connection strings here. |

### Staging PostgreSQL details

| Field                            | Value                                               |
| -------------------------------- | --------------------------------------------------- |
| Provider                         | Render                                              |
| Resource name                    | `tradieos-staging-db`                               |
| Database name                    | `tradieos_staging`                                  |
| Database user                    | `tradieos_staging`                                  |
| Region                           | Singapore (Southeast Asia)                          |
| PostgreSQL version               | 16                                                  |
| Instance                         | Basic-256mb                                         |
| RAM                              | 256 MB                                              |
| CPU                              | 0.1 CPU                                             |
| Storage                          | 1 GB                                                |
| Storage autoscaling              | Disabled                                            |
| High availability                | Disabled                                            |
| Database instance monthly price  | USD $6.00/month                                     |
| Storage monthly price            | USD $0.30/month                                     |
| Current staging PostgreSQL total | USD $6.30/month                                     |
| Status                           | Being provisioned / configured                      |
| Credential location              | Render environment/private connection configuration |

## Render account / workspace

| Field          | Value                              |
| -------------- | ---------------------------------- |
| Provider       | Render                             |
| Workspace      | TradieOS                           |
| Usage          | TradieOS API + staging PostgreSQL  |
| Account owner  | Project owner                      |
| Login email    | Stored securely outside repository |
| Authentication | GitHub-connected account           |

Do not record the personal GitHub email address in this repository.

## Staging API

| Field                  | Value                                          |
| ---------------------- | ---------------------------------------------- |
| Provider               | Render                                         |
| Resource               | Web Service                                    |
| Expected resource name | `tradieos-staging-api`                         |
| Region                 | Singapore (Southeast Asia)                     |
| Expected runtime       | Node >=22                                      |
| Package manager        | pnpm 11.7.0                                    |
| Expected build         | `pnpm install --frozen-lockfile && pnpm build` |
| Expected start         | `pnpm --filter @tradieos/api start:prod`       |
| Expected migration     | `pnpm db:migrate`                              |
| Health                 | `GET /api/health`                              |
| Readiness              | `GET /api/ready`                               |
| Status                 | Not created yet                                |
| Monthly cost           | TBD                                            |

Do not invent or commit API credentials. API secrets belong in Render
environment variables.

## Storage

| Field           | Value                                                                  |
| --------------- | ---------------------------------------------------------------------- |
| Environment     | Staging                                                                |
| Provider        | TBD - expected Cloudflare R2                                           |
| Purpose         | Private field media / documents / quote PDFs / invoice PDFs / receipts |
| Bucket          | TBD                                                                    |
| Region/location | TBD                                                                    |
| Public access   | Private                                                                |
| Credentials     | Stored securely outside repository / deployment secret store           |
| Monthly cost    | TBD                                                                    |
| Status          | Not configured                                                         |

## Email

| Field          | Value                                                             |
| -------------- | ----------------------------------------------------------------- |
| Provider       | Resend                                                            |
| Purpose        | TradieOS outbound/customer emails + password reset                |
| Environment    | Staging                                                           |
| Sending domain | TBD                                                               |
| From address   | TBD                                                               |
| Credentials    | Stored securely outside repository / Render environment variables |
| Monthly cost   | TBD                                                               |
| Status         | Not configured                                                    |

## SMS

| Field        | Value                                                             |
| ------------ | ----------------------------------------------------------------- |
| Provider     | Twilio                                                            |
| Purpose      | Outbound customer SMS and appointment/reminder communications     |
| Environment  | Staging                                                           |
| Sender       | TBD                                                               |
| Credentials  | Stored securely outside repository / Render environment variables |
| Monthly cost | TBD                                                               |
| Status       | Not configured                                                    |
| Future       | Inbound SMS will be implemented after production core launch.     |

## Mobile

| Field                 | Value                                                            |
| --------------------- | ---------------------------------------------------------------- |
| Provider              | Expo / EAS                                                       |
| Environment           | Staging                                                          |
| App                   | TradieOS Staging                                                 |
| EAS profile           | `staging`                                                        |
| `EXPO_PUBLIC_APP_ENV` | `staging`                                                        |
| Expected API          | `https://staging-api.tradieos.com/api`                           |
| iOS bundle            | `au.com.tradieos.mobile.staging`                                 |
| Android package       | `au.com.tradieos.mobile.staging`                                 |
| Status                | Not built yet                                                    |
| Monthly/build cost    | TBD                                                              |
| Credentials           | Stored in Expo/EAS/Apple/Google account systems, not repository. |

## Domains

| Environment | Purpose         | Domain                     | Status      |
| ----------- | --------------- | -------------------------- | ----------- |
| Staging     | API             | `staging-api.tradieos.com` | Planned     |
| Staging     | Web/reset       | `staging.tradieos.com`     | Planned     |
| Production  | API             | `api.tradieos.com`         | Planned     |
| Production  | Public app/site | `tradieos.com`             | Planned/TBD |

## Production environment

Production resources must be separate from staging. Do not copy staging
credentials, connection strings or provider resources into production.

| Resource                | Status          | Monthly cost | Notes                                                      |
| ----------------------- | --------------- | ------------ | ---------------------------------------------------------- |
| Production DB           | Not provisioned | TBD          | Use a separate managed PostgreSQL instance.                |
| Production API          | Not provisioned | TBD          | Use production-specific environment variables and domains. |
| Production storage      | Not provisioned | TBD          | Use a separate private production bucket.                  |
| Production email        | Not configured  | TBD          | Use production-approved sending domain/from address.       |
| Production SMS          | Not configured  | TBD          | Use production-approved sender/account configuration.      |
| Production mobile build | Not created     | TBD          | Use production EAS profile and production identifiers.     |

## Monthly cost summary

| Environment | Provider         | Resource                               | Monthly cost    | Status          |
| ----------- | ---------------- | -------------------------------------- | --------------- | --------------- |
| Staging     | Render           | PostgreSQL Basic-256mb                 | USD $6.00/month | Confirmed       |
| Staging     | Render           | 1 GB PostgreSQL storage                | USD $0.30/month | Confirmed       |
| Staging     | Render           | Current committed infrastructure total | USD $6.30/month | Confirmed       |
| Staging     | Render           | API web service                        | TBD             | Not created     |
| Staging     | Cloudflare R2/S3 | Private media/PDF storage              | TBD             | Not configured  |
| Staging     | Resend           | Email delivery                         | TBD             | Not configured  |
| Staging     | Twilio           | SMS delivery                           | TBD             | Not configured  |
| Staging     | Expo / EAS       | Staging mobile build                   | TBD             | Not built       |
| Production  | TBD              | Production infrastructure total        | TBD             | Not provisioned |

Do not add unconfirmed estimates. Keep `TBD` until the provider plan, invoice or
pricing decision is confirmed.

## Credential management

Never commit:

- passwords
- API keys
- database URLs
- database passwords
- access tokens
- secret keys
- JWT secrets
- private certificates
- Apple signing credentials
- Google Play service account files
- password-reset tokens
- GitHub access tokens
- S3/R2 access keys
- S3/R2 secret access keys
- Resend API keys
- Twilio auth tokens
- OpenAI API keys
- EAS credentials

Credentials should live in:

- Render environment variables
- Cloudflare provider secrets
- Resend dashboard
- Twilio dashboard
- EAS secrets/environment variables
- Apple/Google provider systems
- project owner's password manager

Use safe inventory wording such as:

- `Stored securely outside repository`
- `Configured in Render environment variables`
- `Stored in provider dashboard`

## Infrastructure change log

| Date       | Environment | Provider | Change                                         | Cost impact     |
| ---------- | ----------- | -------- | ---------------------------------------------- | --------------- |
| 2026-08-21 | Staging     | Render   | Selected PostgreSQL Basic-256mb + 1 GB storage | USD $6.30/month |

## Future maintenance rule

Whenever we create or change any of the following, update
`docs/INFRASTRUCTURE_INVENTORY.md`:

- hosting
- database
- storage
- domain
- email provider
- SMS provider
- EAS build configuration
- monthly subscription

Never add the credentials themselves.
