# Frontend guide (all Pay with ARAF web apps)

## Apps and ports

| App | Path | Port | Audience |
| --- | --- | --- | --- |
| Hosted customer checkout | `apps/customer-checkout` | 3001 | Customers (mobile-first) |
| Partner portal | `apps/partner-portal` | 3002 | Merchant staff |
| Bank administration portal | `apps/admin-portal` | 3003 | Bank staff |
| Developer portal | `apps/developer-portal` | 3004 | Partner developers |
| AltMall demo storefront | `apps/altmall-demo` | 3005 | Demo shoppers (an *external* merchant) |
| API | `apps/api` | 4000 | — |

All apps are Next.js 15 (App Router) + React 19 + Tailwind 3 using the shared preset
(`@araf/design-tokens/tailwind-preset`) and components from `@araf/ui`
(`packages/ui/src`). Run an app with `pnpm --filter @araf/<app> dev`; build with `npx next build`.

## Talking to the API

Browser apps call `/api/...` on their **own origin**; `next.config.mjs` rewrites to the API.
Never call `http://localhost:4000` from browser code. Use the shared client:

```ts
import { createApiClient, ApiError, errorLines } from '@araf/ui';
const api = createApiClient({ csrfCookie: 'araf_csrf_admin' }); // portals
const data = await api.get<T>('/api/admin/overview?range=30d');
await api.post('/api/admin/partners', body);
```

* Error envelope: `{ error: { code, message, retryable, details?, correlation_id } }` →
  `ApiError(status, code, message, details, correlationId)`. Show `errorLines(err)` to users.
* Money is **integer kobo** everywhere. Display with `formatNaira(kobo)`; send kobo for the
  partner API, naira integers only where an endpoint field name ends in `_naira`.
* `401 UNAUTHENTICATED` / `SESSION_EXPIRED` → redirect to the app's sign-in / re-verify screen.
  `401 MFA_REQUIRED` → MFA step.

### Portal authentication (admin & partner)

1. `POST /api/auth/{admin|partner}/login {email,password}` → `{mfa_required:true}`; sets the
   HttpOnly session cookie and the readable CSRF cookie `araf_csrf_{admin|partner}`.
2. `POST /api/auth/{admin|partner}/mfa {code}` (6-digit TOTP) → `{authenticated, csrf_token}`
   (session is rotated; the CSRF cookie is refreshed).
3. `GET /api/auth/{admin|partner}/me` → `{user:{id,email,full_name,roles,permissions[]}, partner, environment, sandbox}`.
   **Hide UI the user lacks permission for** (the API enforces it regardless).
4. `POST /api/auth/{portal}/logout`. Sessions: 15-minute idle timeout, 8-hour absolute.
5. Invitations: `GET /api/auth/invitations/:token` → info; `POST .../accept {password}` →
   `{totp_secret, otpauth_uri}` (show the secret + URI for an authenticator app);
   `POST .../activate {code}` → `{activated, portal}`. Invite links look like `/invite/<token>`
   on the relevant portal.

TOTP replay protection: a code from the same 30-second step cannot be reused.

### Sandbox staff accounts (seeded, sandbox only)

Password for all: `Sandbox-Pass-2026!`. Current TOTP: `node scripts/totp.mjs <email>`.

`superadmin@`, `business@`, `onboarding@`, `partner.approver@`, `analyst@`, `risk@`,
`approver@`, `cad@`, `settlement@`, `finance@`, `ops@`, `cx@`, `compliance@`, `infosec@`,
`auditor@`, `developer@`, `management@` — all `@sandbox.altbank.example`.
Roles/permissions: `packages/types/src/rbac.ts`.

AltMall's partner admin is created by `node scripts/demo-bootstrap.mjs`; credentials are
written to `SANDBOX_CREDENTIALS.local.md` (git-ignored).

## Endpoint reference

The controllers are the source of truth (response shapes are visible in the services):

* Admin: `apps/api/src/admin/admin.controller.ts` (+ `admin.service.ts`, `reports.service.ts`,
  `reviews.service.ts`, `araf.service.ts`, `operations.service.ts`, `partners.service.ts`,
  `approvals.service.ts`)
* Partner portal: `apps/api/src/partners/partner-portal.controller.ts`
* Hosted checkout: `apps/api/src/customer/customer.controller.ts` (+ `journey.service.ts` `view()`)
* Sandbox simulators: `apps/api/src/sandbox/sandbox.controller.ts`
* Public partner API v1: `apps/api/src/checkout/partner-api.controller.ts`
* Webhook events: `packages/types/src/events.ts`; error codes: `packages/types/src/errors.ts`

## Design rules (spec §6)

* Premium, calm, trustworthy. Black / gold / white (provisional tokens), light + dark mode
  (`ThemeToggle`, `themeInitScript` already in each layout).
* Strong typography, consistent spacing, careful tables, purposeful motion only.
* **Avoid**: gradients, glassmorphism, heavy shadows, oversized rounded cards, decorative
  clutter, stock illustrations, slanted type.
* Every list has loading skeletons, empty states and error states. No dead buttons, no
  placeholder screens, no invented metrics — render what the API returns.
* WCAG 2.2 AA: labelled controls (`Field`), visible focus, keyboard operable, sufficient
  contrast, `aria-live` for async status, 44px touch targets on mobile.
* Show `SandboxBanner` at the top of every app (sandbox build).
* Never display full BVNs, account numbers or secrets (except a newly created secret shown once).
* Distinguish clearly: indicative eligibility ≠ submission ≠ approval ≠ agreement ≠ vendor
  payment ≠ goods release.
