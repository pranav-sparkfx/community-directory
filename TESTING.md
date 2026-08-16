# Testing Front Porch

Four suites, each answering a different question. They are separate on purpose:
when something breaks, the suite that fails tells you which layer moved.

| Suite | Question it answers | Command |
|---|---|---|
| SQL (5 files, 121 assertions) | Can anyone read or write what they should not? | `npm run db:test` |
| Unit (16) | Do the pure helpers and the bundle budget hold? | `npm test` |
| E2E (44 across 2 browsers) | Do whole journeys work, end to end? | `npm run test:e2e` |
| Accessibility (inside E2E) | WCAG 2.2 AA, keyboard, target size, OS preferences | included above |

## Before you run anything

The E2E and SQL suites run against the **local Supabase stack and the seeded
Summerlake community**. They are not self-provisioning, deliberately: a suite
that silently starts an empty database produces confident green runs that
prove nothing.

```bash
npx supabase start          # Postgres, GoTrue, PostgREST, Kong
npx supabase db reset       # migrations + the Summerlake seed
npm run dev                 # http://localhost:3000
```

After `db reset`, Kong sometimes holds a stale connection:

```bash
docker restart supabase_kong_Community-directory
```

## The SQL suites

These are the security boundary. Each runs inside a transaction that is rolled
back, so they leave no trace and can be re-run against the same database.

| File | Covers |
|---|---|
| `rls_adversarial.sql` | Row-level security across every table |
| `phase3_claim_verify.sql` | Claiming an address and being verified |
| `phase4_communities_roles.sql` | Invites, roles, ownership, sub-communities |
| `phase5_moderation.sql` | Announcements, listings, reports, the inbox |
| `phase6_pen_test.sql` | Attacks that bypass the RPCs and write tables directly |

They share one discipline worth knowing before you add to them:

> **A correct refusal arrives as an exception OR as zero rows affected.**
> A test that only catches the exception will report a breach when RLS quietly
> filters the row instead — that produced a false "moderator made the community
> public" finding during Phase 6. Assert on `row_count` and on the value, not
> just on the absence of an error.

The scratch table used to pass values between blocks must be granted to
`authenticated`, or every block fails on the scratch table rather than on the
thing under test — and the exception handler reports that as a pass.

## The E2E suite

```bash
npm run test:e2e                          # both browsers
npx playwright test --project=iphone      # mobile Safari (WebKit)
npx playwright test --project=desktop     # desktop Chrome
npx playwright test --ui                  # watch it happen
```

Two projects: an iPhone 14 viewport on WebKit, because that is where this app
is actually used, and desktop Chrome to catch layouts that only hold at one
width. Workers are pinned to 1 — several journeys write to the shared seeded
database, and running them concurrently would make failures depend on
scheduling order.

**Known skip:** the keyboard-traversal test does not run on WebKit. Safari's
Tab order skips buttons and links unless the user has switched on Full
Keyboard Access, and headless WebKit inherits that default. The focus styles
are engine-independent CSS, so the test runs on Chromium where Tab traversal
is standard.

**Do not run `next build` while the E2E suite is running.** The build rewrites
`.next` underneath the dev server and produces a failure that looks like a
product bug.

## Accessibility

`expectNoA11yViolations()` runs axe against `wcag2a`, `wcag2aa`, `wcag21a`,
`wcag21aa` and `wcag22aa` — conformance tags only. Adding `best-practice`
would produce a list nobody acts on, which is how accessibility testing turns
into decoration.

The MapLibre canvas is excluded from the scan: it is a WebGL surface with no
accessible tree of its own. The same information is available as a real list
underneath it, and that list **is** scanned.

What axe cannot judge lives in `e2e/a11y-manual.spec.ts`: whether the app can
be operated without a mouse, whether focus is ever visible, whether every
target clears 24×24, and whether `prefers-reduced-motion` and
`prefers-contrast` actually take effect.

> Use `page.emulateMedia()`, not `test.use({ reducedMotion })`. The fixture
> option silently does nothing in this Playwright version — `matchMedia` inside
> the page still reports `no-preference`, so the test passes against an
> un-emulated browser and proves nothing.

## Performance

Byte budgets are checked at build time from the manifest
(`src/lib/bundle-budget.test.ts`), not in a browser. A browser measurement
needs a signed-in session, and the dev sign-in button is correctly absent from
production builds — so it would either measure the dev server (unminified,
meaningless) or need a fabricated session cookie.

```bash
npm run build && npm test
```

The current shared shell is ~127 kB gzipped plus ~39 kB of polyfills that
modern browsers never fetch. MapLibre (~240 kB) sits behind a dynamic import
inside an effect; `e2e/budget.spec.ts` asserts **both** directions of that
split, because checking only that content screens skip it would still pass if
the map stopped loading it too — i.e. if the map broke entirely.

## Adding a test

- Prefer role and accessible name over CSS selectors. A restyle should not
  break the suite; a broken label should.
- Use `visit(page, path)` from `e2e/helpers.ts` rather than `page.goto`. Next's
  client router can start a navigation just as a test starts one, and
  Playwright treats that as an error rather than a retry.
- If a value has no role or label to target — an invite code, for instance —
  add a `data-testid` rather than matching on shape. The invite screen renders
  the same 8-character pattern in two places, and "the first one on the page"
  silently grabbed the wrong one.
