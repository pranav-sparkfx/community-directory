import { expect, test } from "@playwright/test";
import { PEOPLE, signIn, visit } from "./helpers";

/**
 * Nothing may scroll the page sideways on a phone.
 *
 * A horizontal scrollbar on mobile is not a cosmetic defect: it shifts the
 * whole layout under the thumb mid-tap, and it usually means one element is
 * escaping the viewport rather than the design being wide — a fixed pixel
 * width, an unbroken string, or a flex row that refuses to wrap.
 *
 * 320 is included deliberately. It is the narrowest width still worth
 * supporting (iPhone SE 1st gen, and any phone with display zoom turned on),
 * and it is where a layout that merely looks fine at 390 falls apart.
 */
const WIDTHS = [320, 360, 375, 390, 414];

const SCREENS = [
  "/",
  "/services",
  "/communities",
  "/notifications",
  "/announcements",
  "/you",
  // Admin is signed-in-only and easy to forget, and it is the densest layout
  // in the app — queues and tables are where a fixed width hides.
  "/admin",
  "/admin/members",
  "/admin/verify",
] as const;

/** Elements whose right edge escapes the viewport, worst offender first. */
async function overflowingElements(page: import("@playwright/test").Page, width: number) {
  return page.evaluate((vw) => {
    const offenders: { tag: string; cls: string; right: number; width: number }[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
      const rect = el.getBoundingClientRect();
      // A 1px tolerance: sub-pixel layout rounding is not a defect, and
      // asserting on exact equality makes this test flap between browsers.
      if (rect.width > 0 && rect.height > 0 && rect.right > vw + 1) {
        offenders.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.className?.toString() ?? "").slice(0, 70),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
        });
      }
    }
    return offenders.sort((a, b) => b.right - a.right).slice(0, 6);
  }, width);
}

test.describe("No horizontal scroll on mobile", () => {
  for (const width of WIDTHS) {
    test(`every screen fits at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 780 });

      // Checked signed-out first, because the proxy bounces an authenticated
      // request for /sign-in and this is the only chance to measure it.
      // visit() rather than goto(): Next's client router can start a
      // navigation of its own just as this one begins, which is a harness
      // race, not a layout defect, and it made this spec flake at one width.
      await visit(page, "/sign-in");
      const signedOut = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect
        .soft(signedOut.scrollWidth, `/sign-in at ${width}px scrolls horizontally`)
        .toBeLessThanOrEqual(signedOut.clientWidth);

      await signIn(page, PEOPLE.owner);

      for (const path of SCREENS) {
        await page.setViewportSize({ width, height: 780 });
        await visit(page, path);
        await page.waitForLoadState("load");

        const { scrollWidth, clientWidth } = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));

        const offenders = scrollWidth > clientWidth ? await overflowingElements(page, width) : [];
        const detail = offenders
          .map((o) => `      <${o.tag} class="${o.cls}"> right=${o.right} width=${o.width}`)
          .join("\n");

        // Soft, so one bad screen does not hide the state of the five after
        // it. A hard assertion here reported /services and stopped, which
        // said nothing about whether the rest of the app was also broken.
        expect
          .soft(
            scrollWidth,
            `${path} at ${width}px scrolls horizontally ` +
              `(scrollWidth ${scrollWidth} > clientWidth ${clientWidth}). Offenders:\n${detail}`,
          )
          .toBeLessThanOrEqual(clientWidth);
      }
    });
  }
});
