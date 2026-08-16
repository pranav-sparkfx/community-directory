import { expect, test } from "@playwright/test";
import { PEOPLE, signIn, visit } from "./helpers";

/**
 * The performance questions only a real browser can answer.
 *
 * Byte budgets live in src/lib/bundle-budget.test.ts, measured from the build
 * manifest — exact, and no session required. What is left here is what a
 * manifest cannot tell you: whether the code-splitting actually holds at
 * runtime, and whether anything reaches for a third-party host.
 *
 * Both directions of the MapLibre split are asserted. Checking only that
 * content screens skip it would still pass if the map stopped loading it too,
 * i.e. if the map broke entirely.
 */

test.describe("Performance budget", () => {
  test("content screens never fetch the map engine", async ({ page }) => {
    await signIn(page, PEOPLE.resident);

    for (const path of ["/services", "/announcements", "/you", "/notifications"]) {
      await visit(page, path);
      await page.waitForLoadState("load");

      const loadedMapLibre = await page.evaluate(() =>
        performance.getEntriesByType("resource").some((e) => /maplibre/i.test(e.name)),
      );
      expect(loadedMapLibre, `${path} pulled in MapLibre`).toBe(false);
    }
  });

  test("the map screen does fetch it, so the split is real", async ({ page }) => {
    await signIn(page, PEOPLE.resident);
    await visit(page, "/");
    // The import lives inside an effect, so it arrives after load.
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            performance.getEntriesByType("resource").some((e) => /maplibre/i.test(e.name)),
          ),
        { timeout: 15_000 },
      )
      .toBe(true);
  });

  test("no render-blocking third-party requests", async ({ page }) => {
    // Supabase is our backend, not a third party, so it is read from the
    // environment rather than assumed to be localhost. It only passed as
    // "first-party" before because the local stack happens to serve from
    // 127.0.0.1; against a hosted project the same requests are identical in
    // every way that matters to this budget, and hardcoding the local spelling
    // would fail the moment the app is pointed anywhere real.
    const supabaseHost = new URL(
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321",
    ).hostname;

    const thirdParty: string[] = [];
    page.on("request", (r) => {
      const url = new URL(r.url());
      // The tile server is a deliberate, documented dependency of the map.
      const allowed = ["localhost", "127.0.0.1", "tiles.openfreemap.org", supabaseHost];
      if (!allowed.includes(url.hostname)) thirdParty.push(r.url());
    });

    await signIn(page, PEOPLE.resident);
    await visit(page, "/services");
    expect(thirdParty, "unexpected third-party requests").toEqual([]);
  });
});
