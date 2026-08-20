# First-run tutorial for brand users — design

Date: 2026-08-19
Status: approved

## Problem

A brand signs up, lands on the Account screen, and is given no explanation of what RUOStack is
or what to do next. The platform's core bargain — the brand sells under their own label, RUOStack
holds the stock and ships it, the brand's prepaid wallet covers cost — is never stated anywhere
in the product. A new user has to infer a white-label fulfillment model from a sidebar.

Three facts from exploration shape the design.

**1. Half of this already exists.** `GET /api/brand/overview`
(`apps/api/src/routes/brand-overview.ts:23`) already returns
`checklist: { store_connected, wallet_funded, retail_set, first_order }`, computed from real
account state — a `BrandStoreConnection` row, the wallet summary, `BrandProductPrice` count, and
order count. `Overview.tsx:130-162` already renders it as a "Get started" card with a per-item
CTA, and already hides the whole card once all four are true. None of that needs rebuilding. The
gap is the explanatory moment in front of it.

**2. New users never see that checklist.** Signup and login both `navigate('/app/account')`
(`Auth.tsx:67` and `Auth.tsx:114`). The checklist lives on `/app/overview`. A brand's first
session lands them on the one screen that does not tell them what to do.

**3. There is nowhere to record "has been onboarded."** `UserProfile`
(`packages/db/prisma/schema.prisma:127`) carries only `id`, `fullName`, `nameLastChangedAt`, and
timestamps. Nothing distinguishes a first login from a thousandth.

## The model

A five-slide welcome modal on first login, which hands off to the checklist that already exists
on Overview. Completion is recorded server-side, so it follows the user across devices and
browsers rather than re-firing on each new one.

The tour explains; the checklist drives. Neither blocks the app.

## Data model

`packages/db/prisma/schema.prisma`:

```prisma
model UserProfile {
  id                    String    @id @db.Uuid // == auth.users.id
  fullName              String    @map("full_name")
  nameLastChangedAt     DateTime? @map("name_last_changed_at")
  onboardingCompletedAt DateTime? @map("onboarding_completed_at") // NEW — null = tour not finished
  createdAt             DateTime  @default(now()) @map("created_at")
  updatedAt             DateTime  @updatedAt @map("updated_at")

  @@map("user_profile")
}
```

One nullable timestamp rather than a boolean: it answers "did they finish onboarding" and "when"
with the same column, which makes onboarding-completion rate a query rather than a new event
table.

**No backfill.** The migration adds the column and stops; every existing row stays `NULL` and
every current user sees the tour once on their next login. This is deliberate — the explainer is
as useful to a brand who has been guessing for a month as to one signing up tomorrow. The cost is
that current users get interrupted once after deploy, which is acceptable for a dismissable modal.

```sql
ALTER TABLE user_profile ADD COLUMN onboarding_completed_at timestamptz;
```

## API

Both changes land in `apps/api/src/routes/brand.ts` behind the existing `requireBrand` guard.

**`GET /api/brand/me`** (`brand.ts:92`) gains one field in the `profile` block it already
returns:

```ts
profile: {
  id: profile.id,
  full_name: profile.fullName,
  name_last_changed_at: profile.nameLastChangedAt,
  name_editable: ...,
  onboarding_completed_at: profile.onboardingCompletedAt, // NEW
}
```

No new GET endpoint. `Account.tsx:39` already calls `/api/brand/me`, so this is the established
place for per-user state.

**`POST /api/brand/onboarding/complete`** — new, idempotent:

```ts
app.post('/api/brand/onboarding/complete', { preHandler: requireBrand }, async (req) => {
  const { userId } = req.brand!;
  const profile = await prisma.userProfile.findUnique({ where: { id: userId } });
  if (!profile) throw NotFound('Account not found');
  if (profile.onboardingCompletedAt) {
    return { onboarding_completed_at: profile.onboardingCompletedAt };
  }
  const updated = await prisma.userProfile.update({
    where: { id: userId },
    data: { onboardingCompletedAt: new Date() },
  });
  return { onboarding_completed_at: updated.onboardingCompletedAt };
});
```

The early return is what makes replay safe: a user who replays the tour from Account and dismisses
it does not overwrite their original completion time, so the analytics value of the column
survives.

Not written to `AuditLog`. That table records sensitive brand actions — profile edits, member
role changes, email changes. Dismissing a tour is not one, and adding it would dilute the audit
trail.

## Frontend

Three new files in `apps/brand-web`, plus edits to three existing ones.

### `src/lib/onboarding.tsx` — provider and hook

Owns the question "should the tour be on screen right now." Exposes:

```ts
interface OnboardingCtx {
  open: boolean;
  fullName: string;      // slide 1 greets by first name
  complete(): void;      // any dismissal path
  replay(): void;        // reopen without touching server state
}
```

On first render with a session it fetches `/api/brand/me` once and opens the tour when
`onboarding_completed_at` is null. `complete()` closes the modal immediately and fires the POST
without awaiting it — the user should never wait on a network call to dismiss an explainer, and a
failed write costs them one extra viewing rather than a stuck modal.

**Mount point: `main.tsx`, inside `AuthProvider`, wrapping `App`.** Not inside `Protected`.
`Protected` is instantiated separately for each of the eighteen routes in `App.tsx:81-101`, so it
unmounts and remounts on every navigation; a provider living there would refetch `/api/brand/me`
and re-evaluate the modal on each screen change. At the root it fetches once per session.

Two guards keep it out of the way: it renders nothing when `session` is null, and nothing unless
the path starts with `/app` — otherwise a signed-in user who navigates back to `/login` would get
a welcome modal over the login form.

### `src/components/welcomeSlides.tsx` — copy as data

An array of `{ title, body }`. Kept separate from the component so copy revisions never touch
navigation logic.

1. **Welcome to RUOStack, {first name}** — You sell research peptides under your own brand. We
   hold the stock, pack each order, and ship it in your packaging. Your customers never see us.
2. **Your wallet pays for fulfillment** — You keep a prepaid balance. When an order comes in we
   charge your wallet for the product plus shipping; whatever your customer paid you above that
   is your margin. The Profit Calculator prices this out before you commit.
3. **The catalog is your product line** — Browse the research peptide catalog, set your own retail
   price on each product, and push them to your store. Every product carries a COA you can hand to
   customers.
4. **Orders run themselves** — Orders flow in from your connected store. We pack and ship them,
   and tracking comes back into the app on its own. Anything that needs a decision from you lands
   under Action Required.
5. **Four things to set up** — Connect your store, fund your wallet, set your retail prices, and
   place your first order. We'll keep this list on your Overview page until it's done.

### `src/components/WelcomeTour.tsx` — the modal

Purely presentational: takes `open`, `onDismiss`, and `fullName`; holds only the current slide
index. Built on the existing `Dialog` from `@ruostack/ui`
(`packages/ui/src/overlays/Dialog.tsx`) — slide title into `title`, body plus dot indicators into
the children slot, buttons into `footer`. No new component in `packages/ui`; nothing here is
reusable outside this app, and the copy is RUOStack-specific.

Footer buttons: `Skip` (ghost) on the left, `Back` when index > 0, and `Next` — which becomes
`Get started →` on the final slide.

**Every exit path calls `complete()`**: Skip, the Dialog's built-in X, Escape, overlay click, and
finishing slide 5. The tour is informational, so there is no reason to trap anyone in it, and a
user who escapes past it has still made a decision about it. Radix delivers all four close
gestures through the single `onOpenChange` callback, so this is one handler rather than five.

Slide 5's button additionally navigates to `/app/overview`, putting the user in front of the
checklist the slide just described. The signup and login landing routes stay at `/app/account`
— the tour does the routing, so nothing changes for returning users who have already dismissed it.

### Edits to existing screens

**`src/screens/Overview.tsx`** — the "Get started" card gains a `{n} of 4 done` count and a
progress bar above the item list. Structure, data source, and auto-hide behaviour are unchanged.
This is the one surface where a returning user tracks their setup, and it currently gives no sense
of how far along they are.

**`src/screens/Account.tsx`** — a Help card at the bottom of the screen with a
**Replay welcome tour** button calling `useOnboarding().replay()`. Account is where a user looks
for account-level controls, and unlike the Overview card it does not disappear once setup is
complete, so the explainer stays reachable indefinitely.

**`src/main.tsx`** — wrap `<App />` in `<OnboardingProvider>`.

## Testing

**API integration test** — `apps/api/test/integration/brand-onboarding.test.ts`:

- `GET /api/brand/me` returns `onboarding_completed_at: null` for a fresh profile.
- `POST /api/brand/onboarding/complete` sets the timestamp, and a subsequent `GET` reflects it.
- Calling POST a second time returns the *original* timestamp unchanged — the idempotency
  guarantee that makes replay safe.
- Both routes reject an unauthenticated request.

**No frontend unit tests.** `apps/brand-web` has no test runner today, and this change does not
introduce one. The consequence is explicit: the first-run gating, the dismissal-persists path, and
the stays-closed-on-second-login path are covered by manual QA only, and a regression in any of
them will not be caught by `pnpm test`.

Manual QA checklist before merge:

1. Fresh signup → tour appears → walk all five slides → `Get started` lands on Overview.
2. Sign out, sign back in → tour does not reappear.
3. Fresh signup → press Escape on slide 1 → sign out and back in → tour does not reappear.
4. Sign in on a second browser with the same account → tour does not appear.
5. Account → Replay welcome tour → tour opens; dismiss it; reload → tour does not auto-open.
6. Both themes, and at 390px width — the Dialog is `max-w-lg` with a viewport-relative width, so
   the five-slide body must not overflow on a phone.

## Out of scope

- Any tutorial in `apps/admin-web`. It has no signup route and its users are internal staff.
- Spotlight/coach-mark tours over live UI elements.
- Per-screen contextual help beyond the existing empty states.
- Re-triggering the tour when new features ship. If that is wanted later, the timestamp column
  supports it — compare against a feature date rather than checking for null.
