import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/** Seeded Summerlake accounts. Every one of them has the password below. */
export const PEOPLE = {
  owner: "wesley.whitfield1@summerlake.test",
  admin: "kate.trevino9@summerlake.test",
  moderator: "dana.hollis14@summerlake.test",
  resident: "ana.moreno80@summerlake.test",
  otherResident: "ana.petrov16@summerlake.test",
} as const;


/**
 * Sign in through the real form.
 *
 * Uses the dev password button rather than seeding a session cookie: the
 * cookie shape is Supabase's business and a test that fabricates one stops
 * catching auth regressions the moment that shape changes.
 */
export async function signIn(page: Page, email: string) {
  await page.goto("/sign-in");
  await page.getByLabel(/email/i).fill(email);
  await page.getByRole("button", { name: /dev: sign in/i }).click();

  // Sign-in finishes with a CLIENT-side router.push, which resolves after the
  // click promise does. Waiting only for the URL to leave /sign-in returned
  // while that push was still in flight, and the caller's next goto() was
  // then cancelled by it — every journey failed with "interrupted by another
  // navigation to /". Wait for the landing page to actually be loaded.
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), {
    timeout: 20_000,
  });
  await page.waitForLoadState("load");

  // Two navigations race here: the proxy redirects an authenticated request
  // for /sign-in server-side, and the page's own router.push fires when
  // signInWithPassword resolves. Whichever lands second would cancel the
  // caller's next goto(). Waiting for the main nav to be on screen proves the
  // landing page has actually rendered — a URL match alone was still true
  // mid-flight, which is why every journey failed with "interrupted by
  // another navigation to /".
  await page.locator('nav[aria-label="Main"]').first().waitFor({ timeout: 20_000 });
}

/**
 * goto() that tolerates one interruption.
 *
 * Next's client router can issue a navigation of its own just as a test
 * starts one, and Playwright treats that as an error rather than a retry.
 * This is a harness concern, not a product defect — a real person's click
 * simply lands a moment later.
 */
export async function visit(page: Page, path: string) {
  try {
    await page.goto(path);
  } catch (e) {
    if (!(e instanceof Error) || !e.message.includes("interrupted by another navigation")) {
      throw e;
    }
    await page.goto(path);
  }
}

export async function signOut(page: Page) {
  await page.evaluate(() => fetch("/auth/sign-out", { method: "POST" }));
  await page.context().clearCookies();
}

/**
 * WCAG 2.2 AA scan of whatever is on screen.
 *
 * Scoped to the tags that describe an actual conformance target. Running
 * every axe rule including "best-practice" would produce a list nobody acts
 * on, which is how accessibility testing becomes decoration.
 *
 * MapLibre's canvas is excluded: it renders a WebGL surface with no
 * accessible tree of its own, and the app provides the same information as
 * a real list underneath it — which IS in scope and does get scanned.
 */
export async function expectNoA11yViolations(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .exclude(".maplibregl-canvas-container")
    .analyze();

  const summary = results.violations.map(
    (v) =>
      `${v.id} (${v.impact}) — ${v.help}\n    ${v.nodes
        .slice(0, 3)
        .map((n) => n.target.join(" "))
        .join("\n    ")}`,
  );

  expect(summary, `${label} has accessibility violations:\n  ${summary.join("\n  ")}`).toEqual([]);
}
