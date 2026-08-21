# TradieOS Mobile Release Guide

Status: private-beta mobile release runbook.

TradieOS mobile supports three environments:

- development
- staging
- production

The mobile app must receive only client-safe public configuration. Server
secrets must stay in the API/runtime environment and must never be committed to
mobile source, `app.json`, `app.config.js`, `eas.json` or `EXPO_PUBLIC_*`
variables.

## Current mobile architecture

- Expo SDK is used for iOS, Android and web development.
- Expo Go/local development uses `pnpm dev:local` or `pnpm --filter
@tradieos/mobile start`.
- Runtime API configuration is centralised in
  `apps/mobile/src/config/mobileConfig.ts`.
- Shared validation lives in `packages/shared/src/mobile-config.ts`.
- Auth tokens are stored with Expo SecureStore on native iOS/Android. Web
  development uses browser `localStorage`.
- Production app identity remains:
  - iOS bundle identifier: `au.com.tradieos.mobile`
  - Android package: `au.com.tradieos.mobile`
- Staging uses a separate installable identity:
  - iOS bundle identifier: `au.com.tradieos.mobile.staging`
  - Android package: `au.com.tradieos.mobile.staging`
- Staging app name is `TradieOS Staging`.
- Production app name is `TradieOS`.

## Mobile-safe environment variables

Allowed public mobile variables:

```bash
EXPO_PUBLIC_APP_ENV=development|staging|production
EXPO_PUBLIC_API_URL=https://<api-host>/api
IOS_BUILD_NUMBER=<optional numeric/string build number>
ANDROID_VERSION_CODE=<optional positive integer>
EXPO_OWNER=<optional Expo account/owner>
```

`EXPO_PUBLIC_API_URL` must include the `/api` base path.

Do not put these server-only values in mobile configuration:

- `DATABASE_URL`
- `JWT_SECRET`
- `RESEND_API_KEY`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_MESSAGING_FROM`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`
- `OPENAI_API_KEY`
- provider private credentials
- cron/internal worker secrets

## Development

Development can use local HTTP API URLs.

Example:

```bash
EXPO_PUBLIC_APP_ENV=development
EXPO_PUBLIC_API_URL=http://localhost:3000/api
```

For physical-device Expo Go testing, use the computer LAN IP:

```bash
EXPO_PUBLIC_APP_ENV=development
EXPO_PUBLIC_API_URL=http://<LAN-IP>:3000/api
```

Development may use Expo Go, a development build or the local web target.

## Staging / internal beta

Staging builds are for internal testing only.

Requirements:

- `EXPO_PUBLIC_APP_ENV=staging`
- explicit staging HTTPS API URL
- staging backend/database
- safe staging providers or approved test recipients
- no localhost, `127.0.0.1`, LAN IP or HTTP API URL

The staging build uses:

- app name: `TradieOS Staging`
- scheme: `tradieos-staging`
- iOS bundle identifier: `au.com.tradieos.mobile.staging`
- Android package: `au.com.tradieos.mobile.staging`
- EAS profile: `staging`
- distribution: internal

Example commands:

```bash
EXPO_PUBLIC_API_URL=https://staging-api.example.com/api eas build --platform ios --profile staging
EXPO_PUBLIC_API_URL=https://staging-api.example.com/api eas build --platform android --profile staging
```

On Windows PowerShell:

```powershell
$env:EXPO_PUBLIC_API_URL = 'https://staging-api.example.com/api'
eas build --platform ios --profile staging
eas build --platform android --profile staging
```

Use TestFlight for iOS internal testing and Google Play internal testing for
Android once the external Apple/Google accounts are configured.

## Production

Production builds are store-ready and must point only to the production HTTPS
API.

Requirements:

- `EXPO_PUBLIC_APP_ENV=production`
- explicit production HTTPS API URL
- no localhost, `127.0.0.1`, LAN IP or HTTP API URL
- production API, storage and communications providers configured server-side
- no debug environment label in the app name

Production build commands:

```bash
EXPO_PUBLIC_API_URL=https://api.example.com/api eas build --platform ios --profile production
EXPO_PUBLIC_API_URL=https://api.example.com/api eas build --platform android --profile production
```

On Windows PowerShell:

```powershell
$env:EXPO_PUBLIC_API_URL = 'https://api.example.com/api'
eas build --platform ios --profile production
eas build --platform android --profile production
```

Do not submit during this runbook step. Submission should be a separate release
approval.

## EAS profiles

Configured in root `eas.json`:

- `development`
  - development client
  - internal distribution
  - `EXPO_PUBLIC_APP_ENV=development`
- `staging`
  - internal distribution
  - separate staging app identity
  - `EXPO_PUBLIC_APP_ENV=staging`
  - requires explicit HTTPS `EXPO_PUBLIC_API_URL`
- `production`
  - store distribution
  - stable production app identity
  - `EXPO_PUBLIC_APP_ENV=production`
  - requires explicit HTTPS `EXPO_PUBLIC_API_URL`

## Versioning

The base app version lives in `apps/mobile/app.json`.

- Update `expo.version` for product releases.
- Use EAS `autoIncrement` for staging and production build numbers.
- Optional overrides:
  - `IOS_BUILD_NUMBER`
  - `ANDROID_VERSION_CODE`

Avoid reusing the same store build number for multiple submitted builds.

## Permissions

Current requested permissions:

- Camera: capture job evidence photos.
- Photo library/media images: attach job evidence photos.
- Document picker: attach job evidence documents.

TradieOS does not request microphone, phone-call, voice-agent or WhatsApp
permissions because those features are not implemented. Android explicitly
blocks `android.permission.RECORD_AUDIO` in Expo config to prevent native
defaults from shipping an unused microphone permission.

## Deep links

Current schemes:

- development/production: `tradieos`
- staging: `tradieos-staging`

Universal links/app links are not implemented in this private-beta profile.
Public quote/invoice links remain server/API controlled and should continue to
work through the existing public web/mobile routes.

## Expo Go versus standalone builds

Expo Go is for local development and uses local/LAN API URLs.

Standalone staging/production builds:

- embed `EXPO_PUBLIC_*` values at build time;
- must use HTTPS API URLs;
- use SecureStore for native auth token persistence;
- include native modules configured in `app.json`/`app.config.js`.

Current native modules used by the app:

- `expo-secure-store`
- `expo-image-picker`
- `expo-document-picker`
- `expo-file-system`
- native date/time picker

No standalone-build blocker is known from the current configuration, but a real
EAS staging build should be produced and tested before inviting private-beta
users.
