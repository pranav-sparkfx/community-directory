import { expect, test } from "@playwright/test";
import { PEOPLE, expectNoA11yViolations, signIn, visit } from "./helpers";

/**
 * The search overlay — Google-Maps-style suggestions over the map.
 *
 * The assertions worth having here are the ones about the seam between the
 * two indexes. Names and addresses are separate answers to the same query,
 * and every real failure mode in this feature is one of them going out of
 * step with the map: a person whose pin was filtered away a keystroke before
 * they were clicked, a highlighted row that scrolled out of the list the
 * arrow keys were walking. So these tests check the joins, not the pixels.
 */

const SEARCH = /search name or address/i;

test.beforeEach(async ({ page }) => {
  await signIn(page, PEOPLE.resident);
  await visit(page, "/");
  await expect(page.getByLabel(SEARCH)).toBeVisible();
});

test("a name prefix finds people, grouped and labelled", async ({ page }) => {
  await page.getByLabel(SEARCH).fill("ana");

  const list = page.getByRole("listbox", { name: /search results/i });
  await expect(list).toBeVisible();

  const peopleGroup = list.getByRole("group", { name: "People" });
  await expect(peopleGroup.getByRole("option").first()).toBeVisible();
  await expect(peopleGroup.getByRole("option", { name: /Ana Moreno/ })).toBeVisible();

  // Every person offered must actually start a word with "ana" — the whole
  // point of the prefix rule. "Andre" shares two letters and must not appear.
  for (const name of await peopleGroup.getByRole("option").allInnerTexts()) {
    expect(name.toLowerCase()).toMatch(/(^|\s)ana/);
  }
});

test("a surname is a valid starting point, not just a first name", async ({ page }) => {
  await page.getByLabel(SEARCH).fill("moreno");
  await expect(
    page.getByRole("listbox", { name: /search results/i }).getByRole("option", {
      name: /Ana Moreno/,
    }),
  ).toBeVisible();
});

test("an address query fills the Addresses group", async ({ page }) => {
  await page.getByLabel(SEARCH).fill("cedar bend");

  const homes = page
    .getByRole("listbox", { name: /search results/i })
    .getByRole("group", { name: "Addresses" });
  await expect(homes.getByRole("option").first()).toBeVisible();
  await expect(homes.getByRole("option").first()).toContainText(/Cedar Bend/i);
});

/**
 * The regression this whole design exists to prevent.
 *
 * Search used to delete non-matching pins from the map as you typed. Because
 * a person's name has no reason to resemble their address, searching for
 * someone removed their own pin — so picking them flew the camera to a home
 * that was no longer drawn. The map's accessible list mirrors the pin source
 * exactly, which makes "did any pin disappear" a question a test can ask.
 */
test("typing does not remove pins from the map", async ({ page }) => {
  const pins = page.locator(".fp-sr-only li");
  const before = await pins.count();
  expect(before).toBeGreaterThan(0);

  await page.getByLabel(SEARCH).fill("ana");
  await expect(page.getByRole("listbox", { name: /search results/i })).toBeVisible();

  expect(await pins.count()).toBe(before);
});

/**
 * Deliberately a SHARED household.
 *
 * Ana Varadarajan lives at 1434 Heron Ridge with Arjun Ashworth, and there is
 * a second Ana Varadarajan on Flintgrove Loop — so this exercises the case the
 * highlight exists for. Pointing it at someone who lives alone would pass
 * without ever rendering the marked row.
 */
test("picking a person opens their household and marks them within it", async ({ page }) => {
  await page.getByLabel(SEARCH).fill("varadarajan");

  const option = page
    .getByRole("listbox", { name: /search results/i })
    .getByRole("option")
    .filter({ hasText: "1434 Heron Ridge" });
  await expect(option).toHaveCount(1);
  await option.click();

  // The overlay gets out of the way, and the sheet becomes the household.
  await expect(page.getByRole("listbox", { name: /search results/i })).toBeHidden();
  await expect(page.getByRole("heading", { name: /1434 Heron Ridge/i })).toBeVisible();

  // Exactly one resident is marked, and it is the one that was asked for —
  // her housemate is present and unmarked.
  const marked = page.locator("li[aria-current='true']");
  await expect(marked).toHaveCount(1);
  await expect(marked).toContainText("Ana Varadarajan");
  await expect(page.getByRole("listitem").filter({ hasText: "Arjun Ashworth" })).toBeVisible();
  await expect(marked).not.toContainText("Arjun Ashworth");
});

test("the keyboard alone can search and open a household", async ({ page }) => {
  const box = page.getByLabel(SEARCH);
  await box.fill("cedar bend");
  await expect(page.getByRole("listbox", { name: /search results/i })).toBeVisible();

  await box.press("ArrowDown");

  // aria-activedescendant is how a screen reader is told which row is live;
  // if it is not pointing at a real option, the highlight is decoration.
  const activeId = await box.getAttribute("aria-activedescendant");
  expect(activeId).toBeTruthy();
  await expect(page.locator(`#${activeId}`)).toHaveAttribute("aria-selected", "true");

  await box.press("Enter");
  await expect(page.getByRole("listbox", { name: /search results/i })).toBeHidden();
  await expect(page.getByRole("heading", { name: /Cedar Bend/i })).toBeVisible();
});

test("Escape dismisses the overlay without clearing the query", async ({ page }) => {
  const box = page.getByLabel(SEARCH);
  await box.fill("ana");
  await expect(page.getByRole("listbox", { name: /search results/i })).toBeVisible();

  await box.press("Escape");
  await expect(page.getByRole("listbox", { name: /search results/i })).toBeHidden();
  // The text stays: Escape closes the suggestions, it does not undo typing.
  await expect(box).toHaveValue("ana");
});

test("the clear button empties the box and closes the overlay", async ({ page }) => {
  const box = page.getByLabel(SEARCH);
  await box.fill("ana");
  await page.getByRole("button", { name: /clear search/i }).click();

  await expect(box).toHaveValue("");
  await expect(page.getByRole("listbox", { name: /search results/i })).toBeHidden();
});

test("a query matching nothing says so instead of showing an empty panel", async ({ page }) => {
  await page.getByLabel(SEARCH).fill("zzzznobodyhere");
  await expect(page.getByText(/nothing matches/i)).toBeVisible();
});

test("the open overlay is accessible", async ({ page }) => {
  await page.getByLabel(SEARCH).fill("ana");
  await expect(page.getByRole("listbox", { name: /search results/i })).toBeVisible();
  await expectNoA11yViolations(page, "home with search overlay open");
});
