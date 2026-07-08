# TradieOS Documentation

TradieOS is an AI-first SaaS product for Australian tradies. Tori, the AI assistant, is positioned as **Your AI Office Manager**: an office employee in the pocket who helps reduce admin time, improve cash flow, and lower day-to-day stress.

This `/docs` folder is the master documentation source for the project. Future feature work must begin by reading these documents and must not introduce features that conflict with the product direction, tenant model, security rules, or Tori safety rules documented here.

## Documentation index

- [Product Vision](./PRODUCT_VISION.md)
- [Product Requirements Document](./PRD.md)
- [Roadmap](./ROADMAP.md)
- [Architecture](./ARCHITECTURE.md)
- [Database](./DATABASE.md)
- [API](./API.md)
- [AI Tori](./AI_TORI.md)
- [Security](./SECURITY.md)
- [Roles and Permissions](./ROLES_AND_PERMISSIONS.md)
- [UI/UX Guidelines](./UI_UX_GUIDELINES.md)
- [Coding Standards](./CODING_STANDARDS.md)
- [Deployment](./DEPLOYMENT.md)
- [Changelog](./CHANGELOG.md)

## Product rule

TradieOS is not generic job management software. TradieOS is an AI Office Manager.

Every feature must answer:

1. Does this save time?
2. Does this make money?
3. Does this reduce stress?

If the answer is no, do not build it.

## Current implementation summary

The current codebase contains:

- Expo React Native mobile app with web support.
- NestJS API.
- PostgreSQL database with Prisma.
- Multi-tenant business workspace foundation.
- JWT authentication.
- Registration and login.
- Secure mobile token storage using Expo SecureStore.
- Seeded demo business and users.
- Database-backed dashboard summary.
- Placeholder modules for future product areas.

## Demo login

```text
email: owner@demo-tradieos.com
password: password123
```

## Future implementation instruction

Future prompts may begin with:

```text
Read the documentation inside /docs before implementing this feature.
```

When that happens, read this folder first and implement only within the boundaries described here.
