/**
 * Front Porch service worker.
 *
 * Deliberately does NOT cache anything. This is a private directory of
 * people's addresses and phone numbers; a cache that outlives the session
 * would leave a neighbour's contact card readable on a shared laptop after
 * sign-out, and no offline benefit is worth that. The only job here is push.
 */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    // A malformed payload still deserves a tap on the shoulder — the inbox
    // holds the real content either way.
    payload = { title: "Front Porch", body: "You have a new notification." };
  }

  event.waitUntil(
    self.registration.showNotification(payload.title || "Front Porch", {
      body: payload.body || "",
      // Coalesce by target: three announcements should not stack three
      // separate banners on a lock screen.
      tag: payload.tag || "front-porch",
      renotify: false,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { link: payload.link || "/notifications" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || "/notifications";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((tabs) => {
      // Reuse an open tab rather than piling up windows every time someone
      // taps a notification.
      for (const tab of tabs) {
        if (tab.url.includes(self.location.origin) && "focus" in tab) {
          tab.navigate(link);
          return tab.focus();
        }
      }
      return self.clients.openWindow(link);
    }),
  );
});
