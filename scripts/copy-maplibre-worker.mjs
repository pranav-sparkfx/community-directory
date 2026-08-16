/**
 * Stage MapLibre's worker bundle into public/.
 *
 * maplibre-gl 6 no longer inlines its worker as a blob. The main bundle spawns
 * it by resolving `./maplibre-gl-worker.mjs` against its own `import.meta.url`,
 * which after webpack means /_next/static/chunks/maplibre-gl-worker.mjs — a
 * path webpack never emits, because nothing in the module graph imports that
 * file. The request 404s inside the worker bootstrap, so no worker ever
 * starts.
 *
 * That failure is completely silent. MapLibre parses BOTH vector tiles and
 * GeoJSON on the worker, so without one the map fires `dataloading`, never
 * fires `data`, renders no basemap and no pins, and logs nothing at all.
 *
 * Copying the two files here lets setWorkerUrl() in MapCanvas point at a real,
 * stable URL. The shared chunk comes along because the worker imports it by
 * relative path, so the pair has to stay adjacent.
 *
 * Run from predev/prebuild rather than committed, so a maplibre-gl upgrade
 * cannot leave a stale worker behind that mismatches the main bundle.
 */
import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const FILES = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];

const require = createRequire(import.meta.url);
const dist = dirname(require.resolve("maplibre-gl/dist/maplibre-gl.mjs"));
const target = join(process.cwd(), "public", "maplibre");

await mkdir(target, { recursive: true });
for (const file of FILES) {
  await copyFile(join(dist, file), join(target, file));
}

console.log(`[maplibre] staged ${FILES.length} worker files into public/maplibre/`);
