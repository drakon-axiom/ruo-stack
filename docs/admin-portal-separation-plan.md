# Plan: Separate the admin portal from the seller portal (distinct admin shell)

> Status: **proposed — not yet implemented.** Saved for review.
> Decisions locked: (1) distinct admin shell with its own branding; (2) admin
> accounts provisioned via SQL/service-role only (no in-app promotion).

## Context

Admins are not sellers and should never see seller functions (wallet, catalog,
stores, branding, seller dashboard). Today both roles share one shell
(`AppShell`) and an admin landing on `/login` ends up on the seller
`/dashboard`. Goal: make the two portals genuinely separate — admins get their
**own shell with its own identity** ("RUO Admin"), reach only the admin area,
and are routed/redirected accordingly.

## Current state (already changed this session, on disk, uncommitted, verified)

These role-routing pieces are implemented, typecheck-clean, build-green, and
verified with live admin + seller sessions. They are correct under the chosen
direction and will be **kept**:

- `src/middleware.ts` — role-aware routing: admins on a seller prefix
  (`/dashboard`, `/onboarding`, `/checkout`, `/catalog`) → `/admin`; non-admins
  on `/admin` → `/dashboard`. (Verified: 307s in both directions.)
- `src/app/login/page.tsx` — post-login routing by role (admin → `/admin`,
  seller → `/dashboard`), honoring a same-area `next`.
- Earlier same-session fixes that stay: user-scoped reads in
  `src/components/app-shell/AppShell.tsx` + `src/app/dashboard/page.tsx`
  (`.eq('user_id', user.id)`), and migration `0007_fix_profile_guard.sql`.

The one piece to **replace**: the role-exclusive nav logic added to
`AppShellClient` this session — superseded by the dedicated admin shell below.

## Approach: dedicated admin shell

### 1. New admin shell (distinct look)
- **`src/components/admin-shell/AdminShell.tsx`** (server): resolve the user via
  `createClient()` (`src/lib/supabase/server.ts`), pass `email` to the client
  shell. No seller profile/wallet/brand fetch.
- **`src/components/admin-shell/AdminShellClient.tsx`** (client): a visually
  distinct "control plane" shell — cohesive with the design tokens but clearly
  not a storefront:
  - Sidebar header: **"RUO Admin"** wordmark (gradient mark + tracked/mono
    "ADMIN" tag) instead of a seller brand/logo.
  - Admin nav only: Overview `/admin`, Sellers `/admin/sellers`, Orders
    `/admin/orders`, Fulfillment `/admin/fulfillment` (reuse the existing nav
    icons; carry over the `.nav-item`/`.is-active` active-rail and mobile drawer
    pattern from `AppShellClient`).
  - Topbar: section title from `usePathname`, a small live/env marker,
    `ThemeToggle`, and sign-out — **no wallet pill, no subscription badge**.
  - Footer: admin email + `SignOutButton` (reuse
    `src/components/app-shell/SignOutButton.tsx`).
  - Distinct surface treatment (e.g. deeper sidebar tone / accent rail) so it
    reads as a separate console at a glance.

### 2. Point the admin area at the new shell
- **`src/app/admin/layout.tsx`**: wrap children in `AdminShell` instead of
  `AppShell`. Keep the admin gate as defense-in-depth, but redirect non-admins
  to `/dashboard` (consistent with middleware) rather than rendering a 403.

### 3. Make `AppShell` seller-only again
- **`src/components/app-shell/AppShellClient.tsx`**: remove `ADMIN_NAV`, the
  `isAdmin` branching, the role-exclusive `sections` logic, and the admin-only
  icons (`sellers`, `orders`, `admin`, `fulfillment`) no longer referenced.
  Sidebar = `SELLER_NAV` only; wallet pill + subscription badge always shown
  (only sellers reach this shell now).
- **`src/components/app-shell/AppShell.tsx`**: drop `role` from the props it
  passes to the client (keep the user-scoped profile/wallet fetch for brand +
  balance).

### 4. Unchanged
- Admin pages (`src/app/admin/page.tsx`, `sellers/`, `orders/`, `fulfillment/`)
  and shared admin primitives (`src/components/admin/ui.tsx`, `Drawer.tsx`,
  `src/lib/adminApi.ts`) render inside whatever shell the layout provides — no
  change needed.
- Admin provisioning stays SQL/service-role only — no new UI.

## Files
- **New:** `src/components/admin-shell/AdminShell.tsx`,
  `src/components/admin-shell/AdminShellClient.tsx`
- **Modify:** `src/app/admin/layout.tsx`,
  `src/components/app-shell/AppShellClient.tsx`,
  `src/components/app-shell/AppShell.tsx`
- **Keep (already edited):** `src/middleware.ts`, `src/app/login/page.tsx`,
  `src/app/dashboard/page.tsx`

## Verification
- `npm run typecheck` and `npm run build` green.
- Authenticated render against the linked project (dev server on :3900), using
  the existing test accounts:
  - Admin `hawkseye76@pm.me`: `/admin*` renders the **AdminShell** (RUO Admin
    wordmark, admin nav, no wallet/seller chrome); `/dashboard` & `/catalog`
    still 307 → `/admin`.
  - Seller `demo-seller@example.com`: `/dashboard` renders `AppShell` with the
    Selling nav and no admin section; `/admin` still 307 → `/dashboard`.
- Confirm `ThemeToggle` works in the admin shell (light/dark) and the mobile
  drawer opens.
- Then commit + push to `main`.
