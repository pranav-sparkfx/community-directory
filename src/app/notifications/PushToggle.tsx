"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { createClient } from "@/lib/supabase/client";

/**
 * Turn alerts on.
 *
 * Permission is requested from a real tap, never on page load: a browser
 * prompt that appears unbidden gets dismissed reflexively, and a dismissed
 * prompt is close to permanent — there is no second chance to ask.
 *
 * The whole control is absent when the browser cannot do this (no service
 * worker, no Push API, an iOS tab that has not been added to the home
 * screen). Showing a button that opens a dialog explaining why it does not
 * work is worse than showing nothing.
 */
export function PushToggle({ vapidPublicKey }: { vapidPublicKey: string }) {
  const [state, setState] = useState<"checking" | "unsupported" | "off" | "on" | "denied">(
    "checking",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // One async pass, one setState, and a cancellation guard. The earlier
  // version returned early with a synchronous setState for the unsupported
  // and denied cases, which rendered a second time before the browser had
  // painted the first — and could also set state after unmount once the
  // service-worker promise resolved.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const capable =
        typeof window !== "undefined" &&
        "serviceWorker" in navigator &&
        "PushManager" in window &&
        Boolean(vapidPublicKey);

      if (!capable) {
        if (!cancelled) setState("unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        if (!cancelled) setState("denied");
        return;
      }

      try {
        const reg = await navigator.serviceWorker.register("/sw.js");
        const sub = await reg.pushManager.getSubscription();
        if (!cancelled) setState(sub ? "on" : "off");
      } catch {
        if (!cancelled) setState("unsupported");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [vapidPublicKey]);

  async function enable() {
    setBusy(true);
    setError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });

      const json = sub.toJSON();
      const supabase = createClient();
      const { error: rpcError } = await supabase.rpc("save_push_subscription", {
        p_endpoint: sub.endpoint,
        p_p256dh: json.keys?.p256dh ?? "",
        p_auth: json.keys?.auth ?? "",
        p_user_agent: navigator.userAgent,
      });

      if (rpcError) {
        // Leaving the browser subscribed while the server has no record of it
        // would mean a silent, permanently undeliverable subscription.
        await sub.unsubscribe();
        setError(rpcError.message);
        return;
      }
      setState("on");
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setError(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        const supabase = createClient();
        await supabase.rpc("delete_push_subscription", { p_endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      setState("off");
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  if (state === "checking" || state === "unsupported") return null;

  return (
    <div className="fp-card mb-5 flex items-start gap-3.5 px-4 py-3.5">
      <span
        className="inline-flex shrink-0 items-center justify-center rounded-full"
        style={{
          width: 38,
          height: 38,
          background: state === "on" ? "var(--fp-forest-wash)" : "var(--fp-surface-sunk)",
          color: state === "on" ? "var(--fp-forest)" : "var(--fp-ink-3)",
        }}
      >
        <Icon name="bell" size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <p style={{ fontSize: "var(--fp-text-base)", fontWeight: 500 }}>
          {state === "on" ? "Alerts are on" : "Get alerts on this device"}
        </p>
        <p style={{ fontSize: "var(--fp-text-sm)", color: "var(--fp-ink-3)", marginTop: 2 }}>
          {state === "denied"
            ? "Your browser is blocking notifications for this site. Turn them back on in site settings."
            : state === "on"
              ? "Emergencies and announcements reach you even when the app is closed."
              : "For emergencies, maintenance notices and anything an admin decides about you."}
        </p>
        {error ? (
          <p
            role="alert"
            style={{ fontSize: "var(--fp-text-sm)", color: "var(--fp-rejected)", marginTop: 4 }}
          >
            {error}
          </p>
        ) : null}
      </div>
      {state !== "denied" ? (
        <button
          type="button"
          disabled={busy}
          onClick={state === "on" ? disable : enable}
          className="fp-tap shrink-0 rounded-full px-3.5"
          style={{
            border: "1px solid var(--fp-line)",
            fontSize: "var(--fp-text-sm)",
            fontWeight: 500,
            minHeight: 36,
            opacity: busy ? 0.5 : 1,
          }}
        >
          {busy ? "…" : state === "on" ? "Turn off" : "Turn on"}
        </button>
      ) : null}
    </div>
  );
}

/**
 * VAPID keys travel as base64url; PushManager wants raw bytes. Browsers do
 * not accept the string form, and the mismatch surfaces as an opaque
 * "InvalidCharacterError" rather than anything about keys.
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  // Backed by an explicit ArrayBuffer, not the default ArrayBufferLike: the
  // DOM's BufferSource excludes SharedArrayBuffer, and the plain Uint8Array
  // type admits it.
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}
