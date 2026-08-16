"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as MLMap, GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { frontPorchStyle, MAP_TOKENS } from "@/lib/map/style";
import type { HouseholdCollection, HouseholdFeature, MapFocus } from "@/lib/types";

/**
 * Where a fly-to lands.
 *
 * Above clusterMaxZoom (16), and not by accident. Below it the source is
 * still clustering, so the household being flown to has no individual feature
 * on the map at all — the selected-pin layer filters on `id`, matches
 * nothing, and the journey ends on an anonymous cluster dot with no
 * indication which of the homes under it was the answer.
 */
const FOCUS_ZOOM = 17.5;

/**
 * FrontPorch/MapCanvas
 *
 * maplibre-gl is ~200kB gzipped, which alone exceeds the landing budget, so
 * it is dynamically imported inside the effect — it never enters the initial
 * bundle and only loads on the Home tab.
 *
 * Clustering is MapLibre's native GeoJSON clustering rather than a hand-rolled
 * pass: it runs in a worker, and it matches the Kind=Cluster pin in Figma.
 *
 * ACCESSIBILITY: a WebGL canvas is opaque to a screen reader and unreachable
 * by keyboard. The visually-hidden list below is not a courtesy — it is the
 * only way a non-sighted resident can browse the directory at all, so it
 * carries the same data and the same click target as the pins.
 */

/** Renders the Figma teardrop as an image MapLibre can use in a symbol layer. */
function pinDataUri(fill: string, stroke: string, scale = 1): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${30 * scale}" height="${36 * scale}" viewBox="0 0 30 36">
<path d="M15 0C6.7 0 0 6.7 0 15c0 9.8 12.3 19.6 13.6 20.6a2.2 2.2 0 0 0 2.8 0C17.7 34.6 30 24.8 30 15 30 6.7 23.3 0 15 0Z" fill="${fill}" stroke="${stroke}" stroke-width="1.8"/>
<path d="M9 15.2 15 10l6 5.2M10.8 14.2v6h8.4v-6" fill="none" stroke="${stroke}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

async function addPinImage(map: MLMap, id: string, uri: string) {
  if (map.hasImage(id)) return;
  const img = new Image();
  img.src = uri;
  await img.decode();
  if (!map.hasImage(id)) map.addImage(id, img, { pixelRatio: 2 });
}

export function MapCanvas({
  data,
  center,
  zoom,
  selectedId,
  focus,
  onSelect,
  className,
}: {
  data: HouseholdCollection;
  center: [number, number];
  zoom: number;
  selectedId: string | null;
  /** A new object means "centre here now"; null means leave the camera alone. */
  focus?: MapFocus | null;
  onSelect: (feature: HouseholdFeature | null) => void;
  className?: string;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  // Keep the latest handler without re-running the init effect. Assigned in
  // an effect, not during render: React may render a component twice before
  // committing, and a ref written on the discarded pass is a write the user
  // never asked for. The map reads this only from event handlers, which all
  // run after commit.
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    let cancelled = false;
    let map: MLMap | null = null;

    (async () => {
      try {
      const maplibre = await import("maplibre-gl");
      if (cancelled || !holder.current) return;

      // Point MapLibre at the worker staged by scripts/copy-maplibre-worker.mjs.
      // Left to itself it resolves ./maplibre-gl-worker.mjs against the bundle's
      // own import.meta.url — /_next/static/chunks/… under webpack, which 404s
      // because nothing imports that file so nothing emits it. The bootstrap
      // then fails inside the worker and reports nothing: tiles AND GeoJSON are
      // both parsed off-thread, so the map stays empty with a clean console.
      maplibre.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

      // The real style goes to the constructor. An earlier version passed an
      // empty style and called setStyle() on the next line to get the error
      // handler attached first; that call lands while the placeholder is
      // still loading, so MapLibre logs "Unable to perform style diff: Style
      // is not done loading" and rebuilds — and never finishes. `load` never
      // fires, addSource() below never runs, and the map sits blank with no
      // error at all. Attaching the handler on the next line is in time
      // regardless: the constructor only *starts* the style fetch, which
      // cannot resolve before this synchronous block yields.
      map = new maplibre.Map({
        container: holder.current,
        style: frontPorchStyle(),
        center,
        zoom,
        attributionControl: { compact: true },
        // The neighbourhood is the subject; a tilted view adds nothing and
        // makes pin hit targets less predictable on a phone.
        pitchWithRotate: false,
        dragRotate: false,
      });
      mapRef.current = map;
      if (process.env.NODE_ENV === "development") {
        // Dev-only handle so the map can be interrogated from the console.
        (window as unknown as { __fpMap?: MLMap }).__fpMap = map;
      }

      // A MapLibre style or tile failure is otherwise completely silent: the
      // container stays the background colour and nothing reaches the
      // console. Surfacing it is the difference between "the map is broken"
      // and knowing which source failed.
      map.on("error", (e) => {
         
        console.error("[MapCanvas] maplibre error:", e.error?.message ?? e);
        setFailed(e.error?.message ?? "Map failed to load");
      });

      // `style.load`, NOT `load`. MapLibre's `load` waits for the first
      // visually complete render, which means it waits for basemap tiles to
      // download and rasterise. Gating our own pins on that makes the entire
      // directory hostage to a third-party tile CDN: if OpenFreeMap is slow,
      // blocked by a shields/adblock extension, or simply unreachable, `load`
      // never fires, addSource() below never runs, and the resident gets an
      // empty map with no pins, no error banner and nothing in the console.
      // `style.load` fires as soon as the style is parsed and its sources are
      // registered, so the households draw whether or not the ground does.
      map.once("style.load", async () => {
        if (cancelled || !map) return;

        await Promise.all([
          addPinImage(map, "pin-default", pinDataUri("#24503a", "#ffffff", 2)),
          addPinImage(map, "pin-service", pinDataUri("#c4552f", "#ffffff", 2)),
          addPinImage(map, "pin-selected", pinDataUri("#1a3b2b", "#ffffff", 2.6)),
        ]);
        if (cancelled || !map) return;

        map.addSource("households", {
          type: "geojson",
          data,
          cluster: true,
          clusterRadius: 46,
          // Stop clustering once individual homes are meaningfully apart,
          // otherwise a dense cul-de-sac stays a single dot at street level.
          clusterMaxZoom: 16,
        });

        map.addLayer({
          id: "clusters",
          type: "circle",
          source: "households",
          filter: ["has", "point_count"],
          paint: {
            "circle-color": "#24503a",
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 2.5,
            "circle-radius": [
              "interpolate", ["linear"], ["get", "point_count"],
              2, 18, 10, 22, 40, 28,
            ],
          },
        });

        map.addLayer({
          id: "cluster-count",
          type: "symbol",
          source: "households",
          filter: ["has", "point_count"],
          layout: {
            "text-field": ["get", "point_count_abbreviated"],
            "text-font": ["Noto Sans Bold"],
            "text-size": 14,
          },
          paint: { "text-color": "#faf7f0" },
        });

        map.addLayer({
          id: "pins",
          type: "symbol",
          source: "households",
          filter: ["!", ["has", "point_count"]],
          layout: {
            "icon-image": [
              "case",
              ["==", ["get", "kind"], "service"], "pin-service",
              "pin-default",
            ],
            "icon-size": 1,
            "icon-anchor": "bottom",
            "icon-allow-overlap": true,
          },
        });

        // Drawn above `pins` so the selected home is never occluded.
        map.addLayer({
          id: "pin-selected",
          type: "symbol",
          source: "households",
          filter: ["==", ["get", "id"], "__none__"],
          layout: {
            "icon-image": "pin-selected",
            "icon-size": 1,
            "icon-anchor": "bottom",
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
          },
        });

        map.on("click", "pins", (e) => {
          const f = e.features?.[0];
          if (f) onSelectRef.current(f as unknown as HouseholdFeature);
        });

        map.on("click", "clusters", async (e) => {
          const f = e.features?.[0];
          if (!f || !map) return;
          const src = map.getSource("households") as GeoJSONSource;
          const zoomTo = await src.getClusterExpansionZoom(f.properties!.cluster_id);
          map.easeTo({
            center: (f.geometry as GeoJSON.Point).coordinates as [number, number],
            zoom: zoomTo,
          });
        });

        // Tapping the ground dismisses the sheet, which is what a phone user expects.
        map.on("click", (e) => {
          const hits = map!.queryRenderedFeatures(e.point, {
            layers: ["pins", "clusters"],
          });
          if (hits.length === 0) onSelectRef.current(null);
        });

        for (const layer of ["pins", "clusters"]) {
          map.on("mouseenter", layer, () => {
            map!.getCanvas().style.cursor = "pointer";
          });
          map.on("mouseleave", layer, () => {
            map!.getCanvas().style.cursor = "";
          });
        }

        setReady(true);
      });
      } catch (err) {
        // The Map constructor throws synchronously on an invalid style, and
        // an unhandled rejection inside this IIFE would leave a blank canvas
        // with nothing in the console at all.
         
        console.error("[MapCanvas] init failed:", err);
        setFailed(err instanceof Error ? err.message : String(err));
      }
    })();

    // A tab opened in the background throttles requestAnimationFrame to
    // roughly one frame every three seconds. MapLibre defers its style load
    // through rAF, so in that state it never loads, never requests a tile and
    // never errors — it just stays blank. Nudge it the moment the tab is
    // actually shown.
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        mapRef.current?.resize();
        mapRef.current?.triggerRepaint();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      map?.remove();
      mapRef.current = null;
    };
    // Init once. Data and selection are pushed through the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push new data without re-creating the map.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const src = map.getSource("households") as GeoJSONSource | undefined;
    src?.setData(data as unknown as GeoJSON.FeatureCollection);
  }, [data, ready]);

  // Reflect selection in the map layer.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.setFilter("pin-selected", ["==", ["get", "id"], selectedId ?? "__none__"]);
  }, [selectedId, ready]);

  // Fly to a picked search result.
  //
  // Keyed on the identity of `focus`, which is a state object created only
  // when someone picks something — so this does not re-run on unrelated
  // renders, and picking the same home twice does re-centre.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !focus) return;

    // The flight is orientation, not decoration: it shows where in the
    // neighbourhood the answer sits relative to where you were looking. For
    // anyone who has asked the system for less motion, that is not worth
    // 1.1 seconds of movement, so they get the destination directly.
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const camera = {
      center: focus.center,
      zoom: FOCUS_ZOOM,
      // Lifts the pin out of the half of the screen the bottom sheet is about
      // to cover. Computed by the caller, which is the only party that knows
      // how tall the sheet will be.
      offset: focus.offset,
    };

    if (reduced) map.jumpTo(camera);
    else map.flyTo({ ...camera, duration: 1100, essential: true });
  }, [focus, ready]);

  return (
    <>
      <div
        ref={holder}
        className={className}
        style={{
          // Positioning is inline, NOT a utility class. maplibre-gl.css sets
          // `.maplibregl-map { position: relative }` on the container it is
          // given, which overrides an `absolute` class and collapses the
          // element to zero height — the map then renders nothing at all,
          // silently, with no console error. Inline styles win over the
          // library stylesheet, so the size is guaranteed.
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          background: MAP_TOKENS.base,
        }}
        // The canvas itself carries no information for assistive tech; the
        // list below is the equivalent experience.
        aria-hidden="true"
      />

      {failed ? (
        <div
          className="absolute inset-x-0 top-1/2 z-10 mx-auto max-w-xs -translate-y-1/2 rounded-xl px-4 py-3 text-center"
          style={{ background: "var(--fp-surface)", border: "1px solid var(--fp-line)" }}
          role="status"
        >
          <p style={{ fontSize: "var(--fp-text-base)", color: "var(--fp-ink)" }}>
            The map could not load
          </p>
          <p style={{ fontSize: "var(--fp-text-sm)", color: "var(--fp-ink-3)", marginTop: 4 }}>
            Homes are still listed below. {failed}
          </p>
        </div>
      ) : null}

      <div className="fp-sr-only">
        <h2>Homes in this neighbourhood</h2>
        <p>
          {data.features.length} homes are listed on the map. Residents who have
          opted out of the map are not included.
        </p>
        <ul>
          {data.features.map((f) => (
            <li key={f.properties.id}>
              <button type="button" onClick={() => onSelectRef.current(f)}>
                {f.properties.address}
                {f.properties.kind === "service" ? " — offers a neighbourhood service" : ""}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
