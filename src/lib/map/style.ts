import type { StyleSpecification } from "maplibre-gl";

/**
 * The Front Porch map style, generated from the same tokens the app uses.
 *
 * The literals here mirror src/styles/tokens.css. They are duplicated rather
 * than read from CSS because a MapLibre style is plain JSON evaluated inside
 * the GL renderer — it cannot resolve a CSS custom property. The map ground
 * and the app ground must be the same value, so if you change one, change
 * both; the style-guide page renders map-base next to paper so a drift is
 * visible immediately.
 */
export const MAP_TOKENS = {
  base: "#efe8da",
  green: "#dbe4d4",
  water: "#a8c8dc",
  road: "#ffffff",
  roadMinor: "#f7f2e8",
  parcel: "#e6dfd0",
  label: "#8a8578",
  labelHalo: "#faf7f0",
} as const;

/**
 * Tiles come from OpenFreeMap: OpenMapTiles schema, no API key, no request
 * cap. Only the tile SOURCE is theirs — every paint rule below is ours. This
 * is what D5's MapAdapter buys us: swapping to self-hosted Protomaps later
 * changes this one URL and the source-layer names, nothing else.
 */
const TILE_URL = process.env.NEXT_PUBLIC_TILE_SOURCE ?? "https://tiles.openfreemap.org/planet";

export function frontPorchStyle(): StyleSpecification {
  return {
    version: 8,
    name: "Front Porch",
    glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    sources: {
      openmaptiles: { type: "vector", url: TILE_URL },
    },
    layers: [
      {
        id: "background",
        type: "background",
        paint: { "background-color": MAP_TOKENS.base },
      },
      {
        id: "landcover-green",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "landcover",
        filter: ["in", "class", "wood", "grass", "park"],
        paint: { "fill-color": MAP_TOKENS.green, "fill-opacity": 0.85 },
      },
      {
        id: "landuse-park",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "park",
        paint: { "fill-color": MAP_TOKENS.green, "fill-opacity": 0.7 },
      },
      {
        id: "water",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "water",
        paint: { "fill-color": MAP_TOKENS.water },
      },
      {
        id: "buildings",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "building",
        // Footprints only resolve close in; below z14 they are visual noise.
        minzoom: 14,
        paint: { "fill-color": MAP_TOKENS.parcel, "fill-opacity": 0.9 },
      },
      {
        id: "roads-minor",
        type: "line",
        source: "openmaptiles",
        "source-layer": "transportation",
        filter: ["in", "class", "service", "track", "path", "minor"],
        paint: {
          "line-color": MAP_TOKENS.roadMinor,
          "line-width": ["interpolate", ["linear"], ["zoom"], 12, 1, 18, 8],
        },
      },
      {
        id: "roads-major",
        type: "line",
        source: "openmaptiles",
        "source-layer": "transportation",
        filter: ["in", "class", "motorway", "trunk", "primary", "secondary", "tertiary"],
        paint: {
          "line-color": MAP_TOKENS.road,
          "line-width": ["interpolate", ["linear"], ["zoom"], 12, 2, 18, 16],
        },
      },
      {
        id: "road-labels",
        type: "symbol",
        source: "openmaptiles",
        "source-layer": "transportation_name",
        minzoom: 14,
        layout: {
          "symbol-placement": "line",
          "text-field": ["get", "name"],
          "text-font": ["Noto Sans Regular"],
          "text-size": 11,
          "text-letter-spacing": 0.04,
        },
        paint: {
          "text-color": MAP_TOKENS.label,
          "text-halo-color": MAP_TOKENS.labelHalo,
          "text-halo-width": 1.4,
        },
      },
      {
        id: "place-labels",
        type: "symbol",
        source: "openmaptiles",
        "source-layer": "place",
        filter: ["in", "class", "suburb", "neighbourhood", "village", "town"],
        layout: {
          "text-field": ["get", "name"],
          "text-font": ["Noto Sans Regular"],
          "text-size": 13,
          "text-letter-spacing": 0.08,
          "text-transform": "uppercase",
        },
        paint: {
          "text-color": MAP_TOKENS.label,
          "text-halo-color": MAP_TOKENS.labelHalo,
          "text-halo-width": 1.6,
        },
      },
    ],
  };
}
