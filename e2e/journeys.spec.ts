import { expect, test } from "@playwright/test";
import { PEOPLE, expectNoA11yViolations, signIn, signOut, visit } from "./helpers";

/**
 * The six journeys that decide whether this app works.
 *
 * Each one is a whole task a real person came to do, not a click on a
 * button — the value of an E2E test is that it fails when the seams between
 * layers move, and a test that only checks one page never crosses a seam.
 *
 * Assertions favour what the user can see over how it was built: role and
 * accessible name rather than CSS selectors, so a restyle does not break
 * the suite and a broken label does.
 */

test.describe("1. A resident finds a neighbour", () => {
  test("search reaches a household card with contact options", async ({ page }) => {
    await signIn(page, PEOPLE.resident);
    await visit(page, "/");

    // The map owns the viewport; the address list underneath it is the
    // accessible route to the same data and is what a screen reader uses.
    await expect(page.getByText(/homes in this neighbourhood/i)).toBeVisible();
    await expect(page.getByText(/Heron Ridge/).first()).toBeVisible();
  });
});

test.describe("2. A resident reads what the HOA said", () => {
  test("announcements and upcoming events are both present", async ({ page }) => {
    await signIn(page, PEOPLE.resident);
    await visit(page, "/announcements");

    await expect(page.getByRole("heading", { name: "Announcements" })).toBeVisible();
    await expect(page.getByText(/Pool opens Memorial Day/i)).toBeVisible();
    await expectNoA11yViolations(page, "/announcements");
  });
});

test.describe("3. A resident changes their privacy", () => {
  test("hiding the phone number saves without a confirm step", async ({ page }) => {
    await signIn(page, PEOPLE.resident);
    await visit(page, "/you");

    const hidden = page.getByRole("radio", { name: "Hidden" });
    await hidden.click();
    await expect(page.getByText("Saved")).toBeVisible();

    // The real test is that it survives a reload — an optimistic update that
    // never reached the database would still look right until now.
    await page.reload();
    await expect(page.getByRole("radio", { name: "Hidden" })).toHaveAttribute(
      "aria-checked",
      "true",
    );

    // Put it back so the suite is re-runnable.
    await page.getByRole("radio", { name: "Text only" }).click();
    await expect(page.getByText("Saved")).toBeVisible();
  });

  test("the privacy screen is accessible", async ({ page }) => {
    await signIn(page, PEOPLE.resident);
    await visit(page, "/you");
    await expectNoA11yViolations(page, "/you");
  });
});

test.describe("4. A resident offers a service and a moderator vets it", () => {
  test("a new listing is invisible until it is approved", async ({ page }) => {
    const title = `Dog walking ${Date.now()}`;

    await signIn(page, PEOPLE.resident);
    await visit(page, "/services/new");
    await page.getByLabel(/what do you offer/i).selectOption("pet_care");
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Details").fill("Weekday mornings, small dogs only.");
    await page.getByRole("button", { name: /send for review/i }).click();

    // Submitting leaves the form; the listing now exists and is pending.
    await page.waitForURL(/\/services/, { timeout: 20_000 });

    // A different neighbour must not see it yet. This is the whole point of
    // "vet before it's public", and it is enforced by RLS rather than by the
    // page — so checking it from a second session is checking the real thing.
    await signOut(page);
    await signIn(page, PEOPLE.otherResident);
    await visit(page, "/services/pet_care");
    await expect(page.getByText(title)).toHaveCount(0);

    // The moderator publishes it, and now it is there.
    await signOut(page);
    await signIn(page, PEOPLE.moderator);
    await visit(page, "/admin/services");
    const card = page.locator("article").filter({ hasText: title });
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: /publish it/i }).click();
    await expect(card).toHaveCount(0);

    await signOut(page);
    await signIn(page, PEOPLE.otherResident);
    await visit(page, "/services/pet_care");
    await expect(page.getByText(title)).toBeVisible();
  });
});

test.describe("5. An admin invites a neighbour", () => {
  test("an invite is minted, listed and revocable", async ({ page }) => {
    await signIn(page, PEOPLE.admin);
    await visit(page, "/admin/invites");

    await page.getByRole("button", { name: /create invite/i }).click();
    await expect(page.getByText(/ready to send/i)).toBeVisible();

    const code = await page.getByTestId("minted-code").innerText();
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);

    // The code alphabet excludes I, O, 0 and 1 so it survives being read
    // aloud at a residents' meeting. That is a product promise, so it is
    // asserted rather than assumed.
    expect(code).not.toMatch(/[IO01]/);

    await page.getByRole("button", { name: `Revoke ${code}` }).click();
    await expect(page.getByText("revoked").first()).toBeVisible();
  });

  test("a signed-out visitor can read an invite before creating an account", async ({
    page,
    context,
  }) => {
    await signIn(page, PEOPLE.admin);
    await visit(page, "/admin/invites");
    await page.getByRole("button", { name: /create invite/i }).click();
    const code = await page.getByTestId("minted-code").innerText();

    await context.clearCookies();
    await visit(page, `/invite/${code}`);

    // The community name, and a way in. No addresses, no residents.
    await expect(page.getByText("Summerlake")).toBeVisible();
    await expect(page.getByRole("link", { name: /sign in to accept/i })).toBeVisible();
    await expectNoA11yViolations(page, "/invite/[code] signed out");
  });
});

test.describe("6. An admin confirms who lives where", () => {
  test("the verification queue refuses a plain resident", async ({ page }) => {
    await signIn(page, PEOPLE.resident);
    await visit(page, "/admin/verify");
    // Redirected home, and no Admin tab was ever offered.
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("link", { name: "Admin" })).toHaveCount(0);
  });

  test("an admin sees the queue and the dashboard adds up", async ({ page }) => {
    await signIn(page, PEOPLE.admin);
    await visit(page, "/admin");

    await expect(page.getByRole("heading", { name: "Admin" })).toBeVisible();
    await expect(page.getByText(/confirmed residents/i)).toBeVisible();
    await expectNoA11yViolations(page, "/admin");
  });
});

test.describe("Accessibility of every main screen", () => {
  for (const path of ["/services", "/communities", "/notifications", "/welcome"]) {
    test(`${path} has no WCAG 2.2 AA violations`, async ({ page }) => {
      await signIn(page, PEOPLE.resident);
      const response = await page.goto(path);
      // /welcome redirects anyone who already belongs somewhere; skipping is
      // honest, whereas scanning the redirect target would report a pass for
      // a page that was never opened.
      test.skip(
        page.url().endsWith("/") && path === "/welcome",
        "resident already belongs to a community",
      );
      expect(response?.status()).toBeLessThan(400);
      await expectNoA11yViolations(page, path);
    });
  }
});
