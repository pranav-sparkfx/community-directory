import type { MetadataRoute } from "next";

/**
 * Installability.
 *
 * `display: standalone` is the point: an HOA directory is opened from a
 * phone's home screen while standing on someone's porch, not from a browser
 * with a URL bar taking up a tenth of the viewport.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Front Porch — neighbourhood directory",
    short_name: "Front Porch",
    description:
      "Find your neighbours, read HOA announcements, and offer a hand — for the people who actually live here.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#faf6ef",
    theme_color: "#faf6ef",
    categories: ["social", "utilities"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
