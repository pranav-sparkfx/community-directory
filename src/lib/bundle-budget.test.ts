import { existsSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The JavaScript every screen pays for, measured from the build itself.
 *
 * This is a build-time check rather than a browser one on purpose. Measuring
 * in a browser needs a signed-in session, and the dev sign-in button is
 * correctly absent from production builds — so a browser-based budget would
 * either test the dev server (unminified, meaningless) or need a fabricated
 * session cookie. The manifest is exact, deterministic, and cheap.
 *
 * Requires `next build` to have run. Skipped rather than failed when it has
 * not: a missing budget number is a gap, but a red suite on a fresh checkout
 * teaches people to ignore red suites.
 */

const NEXT_DIR = path.join(process.cwd(), ".next");
const MANIFEST = path.join(NEXT_DIR, "build-manifest.json");

// The framework baseline: React, the Next runtime, and the router. Everything
// a resident downloads before a single line of Front Porch code runs.
const BASELINE_BUDGET_KB = 140;

// Polyfills ship behind nomodule and are never fetched by a browser that can
// run this app, so they are measured separately rather than inflating the
// number an actual phone experiences.
const POLYFILL_BUDGET_KB = 45;

type Manifest = {
  rootMainFiles: string[];
  polyfillFiles: string[];
};

function gzippedKb(files: string[]): number {
  const total = files.reduce((sum, file) => {
    const full = path.join(NEXT_DIR, file);
    if (!existsSync(full)) return sum;
    return sum + gzipSync(readFileSync(full)).length;
  }, 0);
  return Math.round((total / 1024) * 10) / 10;
}

describe.skipIf(!existsSync(MANIFEST))("bundle budget", () => {
  const manifest = existsSync(MANIFEST)
    ? (JSON.parse(readFileSync(MANIFEST, "utf8")) as Manifest)
    : { rootMainFiles: [], polyfillFiles: [] };

  it("the shared shell stays under budget", () => {
    const kb = gzippedKb(manifest.rootMainFiles);
    expect(kb, `shared shell is ${kb}kB gzipped`).toBeLessThan(BASELINE_BUDGET_KB);
  });

  it("polyfills stay under budget", () => {
    const kb = gzippedKb(manifest.polyfillFiles);
    expect(kb, `polyfills are ${kb}kB gzipped`).toBeLessThan(POLYFILL_BUDGET_KB);
  });

  it("the map engine is not in the shared shell", () => {
    // MapLibre is ~240kB gzipped. It lives behind a dynamic import inside an
    // effect so only the map screen pays for it. A stray static import would
    // roughly triple this baseline for every screen, and nothing would
    // visibly break — which is exactly the kind of regression that survives
    // code review.
    const offenders = manifest.rootMainFiles.filter((file) => {
      const full = path.join(NEXT_DIR, file);
      return existsSync(full) && /maplibre/i.test(readFileSync(full, "utf8"));
    });

    expect(offenders, "MapLibre leaked into the shared shell").toEqual([]);
  });
});
