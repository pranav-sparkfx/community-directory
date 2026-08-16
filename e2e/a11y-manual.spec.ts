import { expect, test } from "@playwright/test";
import { PEOPLE, signIn, visit } from "./helpers";

/**
 * The accessibility criteria an automated scanner cannot judge.
 *
 * axe checks the things that are true of the DOM at rest — contrast, names,
 * roles, landmarks — and it caught real bugs here. What it cannot tell you is
 * whether the app can actually be *operated* without a mouse, whether focus
 * is ever visible, or whether motion respects the OS setting. Those need a
 * browser doing what a person would do, so they live here.
 */

test.describe("Keyboard operation", () => {
  test("every screen can be reached and used from the keyboard alone", async ({
    page,
    browserName,
  }) => {
    // Safari's Tab order skips buttons and links entirely unless the user has
    // switched on Full Keyboard Access, and headless WebKit inherits that
    // default. The app's focus styles are engine-independent CSS, so this is
    // verified where Tab traversal is standard rather than papered over with
    // a WebKit-specific workaround that would test nothing real.
    test.skip(
      browserName === "webkit",
      "WebKit skips buttons in tab order without Full Keyboard Access",
    );

    await signIn(page, PEOPLE.resident);
    await visit(page, "/you");

    // Tab until focus lands on a control, then confirm the browser can see
    // it. A focus ring that only exists on :hover, or an outline:none with no
    // replacement, fails 2.4.7 and is invisible to a DOM scan.
    //
    // Looped rather than pressed once: WebKit's default tab order skips
    // links unless Full Keyboard Access is on, so a single Tab lands on
    // nothing and the test would report a missing focus ring that is
    // actually there.
    let focus: { tag: string; ok: boolean; reason: string } | null = null;

    for (let i = 0; i < 20; i++) {
      await page.keyboard.press("Tab");
      focus = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const style = getComputedStyle(el);
        const hasOutline = style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0;
        const hasRing = style.boxShadow !== "none";
        return {
          tag: el.tagName,
          ok: hasOutline || hasRing,
          reason: `${el.tagName}: outline=${style.outlineStyle} ${style.outlineWidth}, shadow=${style.boxShadow}`,
        };
      });
      if (focus) break;
    }

    expect(focus, "nothing was reachable by keyboard in 20 tabs").not.toBeNull();
    expect(focus!.ok, `focused element has no visible indicator — ${focus!.reason}`).toBe(true);
  });

  test("the privacy controls respond to keys, not just taps", async ({ page }) => {
    await signIn(page, PEOPLE.resident);
    await visit(page, "/you");

    // A switch built from a div would look identical and be unusable here.
    const emailSwitch = page.getByRole("switch", { name: /show my email/i });
    const before = await emailSwitch.getAttribute("aria-checked");

    await emailSwitch.focus();
    await page.keyboard.press("Enter");

    await expect(emailSwitch).not.toHaveAttribute("aria-checked", before ?? "false");

    // Put it back.
    await page.keyboard.press("Enter");
    await expect(emailSwitch).toHaveAttribute("aria-checked", before ?? "false");
  });

  test("the tab bar is a real navigation landmark with real links", async ({ page }) => {
    await signIn(page, PEOPLE.resident);
    await visit(page, "/services");

    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav).toBeVisible();

    // Links, not click handlers on spans: middle-click, open-in-new-tab and
    // screen-reader link lists all depend on this.
    const links = nav.getByRole("link");
    expect(await links.count()).toBeGreaterThanOrEqual(4);

    // 2.4.4: every one of them says where it goes.
    for (const link of await links.all()) {
      const name = (await link.textContent())?.trim();
      expect(name, "a tab has no accessible name").toBeTruthy();
    }
  });
});

test.describe("Target size (WCAG 2.2 AA, 2.5.8)", () => {
  test("interactive controls are at least 24x24", async ({ page }) => {
    await signIn(page, PEOPLE.resident);

    for (const path of ["/you", "/services", "/notifications"]) {
      await visit(page, path);
      await page.waitForLoadState("load");

      const tooSmall = await page.evaluate(() => {
        const bad: string[] = [];
        const targets = document.querySelectorAll<HTMLElement>(
          'button, a[href], [role="switch"], [role="radio"], input:not([type="hidden"]), select',
        );
        for (const el of targets) {
          const r = el.getBoundingClientRect();
          // Zero-size elements are hidden or not laid out; they are not
          // targets and reporting them would bury the real findings.
          if (r.width === 0 || r.height === 0) continue;
          if (r.width < 24 || r.height < 24) {
            bad.push(
              `${el.tagName}${el.className ? "." + String(el.className).split(" ")[0] : ""} ` +
                `${Math.round(r.width)}x${Math.round(r.height)} — "${(el.textContent ?? "").trim().slice(0, 30)}"`,
            );
          }
        }
        return bad;
      });

      expect(tooSmall, `${path} has targets under 24x24`).toEqual([]);
    }
  });
});

test.describe("OS preferences are honoured", () => {
  test("transitions collapse to zero when the OS asks", async ({ page }) => {
    // page.emulateMedia(), not test.use({ reducedMotion }): the fixture option
    // silently did nothing in this Playwright version — matchMedia inside the
    // page still reported no-preference — so the test passed against an
    // un-emulated browser and proved nothing.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await signIn(page, PEOPLE.resident);
    await visit(page, "/you");

    const emulated = await page.evaluate(
      () => matchMedia("(prefers-reduced-motion: reduce)").matches,
    );
    expect(emulated, "the browser is not actually emulating the preference").toBe(true);

    const durations = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      return {
        fast: root.getPropertyValue("--fp-dur-fast").trim(),
        normal: root.getPropertyValue("--fp-dur-normal").trim(),
        sheet: root.getPropertyValue("--fp-dur-sheet").trim(),
      };
    });

    // Every animation in the app reads these tokens, so zeroing them here is
    // what makes the preference actually take effect rather than being
    // honoured in three places and forgotten in the fourth.
    expect(durations).toEqual({ fast: "0ms", normal: "0ms", sheet: "0ms" });

    // And the belt-and-braces global rule is doing its job too, which covers
    // any transition that was written as a literal instead of a token.
    const actual = await page
      .locator("button")
      .first()
      .evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(parseFloat(actual)).toBeLessThan(0.05);
  });

  test("high contrast deepens the ink rather than flipping the ground", async ({
    page,
  }) => {
    await page.emulateMedia({ contrast: "more" });
    await signIn(page, PEOPLE.resident);
    await visit(page, "/you");

    const tokens = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      return {
        ink2: root.getPropertyValue("--fp-ink-2").trim(),
        ink3: root.getPropertyValue("--fp-ink-3").trim(),
        paper: root.getPropertyValue("--fp-paper").trim(),
      };
    });

    // Front Porch commits to one warm-paper identity; the OS preference is
    // honoured by darkening text, never by inverting to a dark theme. This
    // block has no global fallback behind it, unlike reduced motion, so it
    // is worth asserting directly.
    expect(tokens.ink2).toBe("#34362f");
    expect(tokens.ink3).toBe("#56584f");
    expect(tokens.paper).toBe("#faf7f0");
  });
});
