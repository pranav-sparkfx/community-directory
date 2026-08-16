"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Why a sign-in attempt bounced back here.
 *
 * Two sources, because two different things reject a link. Our own callback
 * route reports in the query string; GoTrue reports in the URL fragment, which
 * survives every redirect the browser makes on the way here and so is still
 * readable even though `/` sent us on. Without this the resident sees the
 * sign-in form again with no explanation, assumes the click did not register,
 * and clicks the emailed link a second time — which spends the one-time token
 * and turns a recoverable problem into "Email link is invalid or has expired".
 */
const SIGN_IN_ERRORS: Record<string, string> = {
  missing_code: "That link did not carry a sign-in code. Request a fresh one below.",
  link_expired: "That link has already been used or has expired. Request a fresh one below.",
  otp_expired: "That link has already been used or has expired. Request a fresh one below.",
  access_denied: "That sign-in link is no longer valid. Request a fresh one below.",
};

function readSignInError(): string | null {
  const query = new URLSearchParams(window.location.search);
  const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));

  const code =
    query.get("error") ?? fragment.get("error_code") ?? fragment.get("error");
  if (!code) return null;

  return (
    SIGN_IN_ERRORS[code] ??
    fragment.get("error_description")?.replace(/\+/g, " ") ??
    "That sign-in link did not work. Request a fresh one below."
  );
}

/**
 * The URL is an external store, so it is read through useSyncExternalStore
 * rather than an effect: the server has no fragment to render, and this is the
 * hook that lets the server and client snapshots differ without a hydration
 * mismatch. The result is cached per href because getSnapshot must return a
 * value stable under Object.is — error_description builds a fresh string every
 * call, which would otherwise re-render forever.
 */
let cachedHref: string | null = null;
let cachedError: string | null = null;

function signInErrorSnapshot(): string | null {
  if (window.location.href !== cachedHref) {
    cachedHref = window.location.href;
    cachedError = readSignInError();
  }
  return cachedError;
}

// The URL cannot change under us without a navigation that remounts this page,
// so there is nothing to subscribe to.
const noSubscribe = () => () => {};

/**
 * Sign in — magic link.
 *
 * Email rather than SMS by default (decision D9): neighbours are phone-centric
 * but every SMS costs money, so a phone number is verified only when someone
 * chooses to be callable. That keeps the verified badge meaningful without a
 * per-signup bill.
 *
 * In development a password path is offered as well, because the seeded
 * Summerlake residents exist with a known password and clicking through
 * Mailpit on every reload is friction with no payoff. It is compiled out of
 * production builds.
 */
export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isDev = process.env.NODE_ENV === "development";

  const linkError = useSyncExternalStore(noSubscribe, signInErrorSnapshot, () => null);
  // A live error from this session's own submit outranks the one the URL
  // arrived with.
  const shownError = error ?? linkError;

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath())}`,
      },
    });
    setBusy(false);
    if (error) setError(error.message);
    else setSent(true);
  }

  /**
   * Where to land after signing in.
   *
   * Read from the query string at call time rather than through
   * useSearchParams, which would force this whole screen behind a Suspense
   * boundary for a value only ever needed inside an event handler. Only
   * same-site paths are honoured: an open redirect on a sign-in page is how
   * a phishing link borrows your domain.
   */
  function nextPath() {
    const raw = new URLSearchParams(window.location.search).get("next");
    return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";
  }

  async function devPassword(e: React.MouseEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: email || "wesley.whitfield1@summerlake.test",
      password: "summerlake",
    });
    setBusy(false);
    if (error) setError(error.message);
    else router.push(nextPath());
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-12">
      <p className="fp-eyebrow">Front Porch</p>
      <h1 style={{ fontSize: "var(--fp-text-2xl)", marginTop: 8 }}>
        Your neighbourhood, not a spreadsheet
      </h1>
      <p style={{ color: "var(--fp-ink-2)", marginTop: 12 }}>
        Sign in with the email your HOA has on file. We will send you a link —
        no password to remember.
      </p>

      {sent ? (
        <div className="fp-card mt-8 px-4 py-4">
          <h2 style={{ fontSize: "var(--fp-text-lg)" }}>Check your email</h2>
          <p style={{ color: "var(--fp-ink-2)", marginTop: 8, fontSize: "var(--fp-text-base)" }}>
            We sent a sign-in link to <strong>{email}</strong>. It expires in an
            hour.
          </p>
          {isDev ? (
            <p style={{ color: "var(--fp-ink-3)", marginTop: 12, fontSize: "var(--fp-text-sm)" }}>
              Local development: the message is waiting in Mailpit at{" "}
              <a href="http://127.0.0.1:54324" target="_blank" rel="noreferrer">
                127.0.0.1:54324
              </a>
              .
            </p>
          ) : null}
        </div>
      ) : (
        <form onSubmit={sendMagicLink} className="mt-8">
          <label
            htmlFor="email"
            style={{ fontSize: "var(--fp-text-sm)", color: "var(--fp-ink-2)" }}
          >
            Email address
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="mt-2 w-full rounded-xl px-4"
            style={{
              height: "var(--fp-control-h)",
              background: "var(--fp-surface)",
              border: "1px solid var(--fp-line)",
              fontSize: "var(--fp-text-base)",
            }}
          />

          {shownError ? (
            <p
              role="alert"
              style={{ color: "var(--fp-rejected)", fontSize: "var(--fp-text-sm)", marginTop: 10 }}
            >
              {shownError}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={busy}
            className="fp-tap mt-4 w-full rounded-xl"
            style={{
              height: "var(--fp-control-h)",
              background: "var(--fp-forest)",
              color: "var(--fp-ink-inverse)",
              fontSize: "var(--fp-text-base)",
              fontWeight: 600,
              opacity: busy ? 0.6 : 1,
            }}
          >
            {busy ? "Sending…" : "Send me a link"}
          </button>

          {isDev ? (
            <button
              type="button"
              onClick={devPassword}
              className="fp-tap mt-3 w-full rounded-xl"
              style={{
                height: "var(--fp-control-h)",
                background: "var(--fp-surface-sunk)",
                color: "var(--fp-ink-2)",
                fontSize: "var(--fp-text-sm)",
                border: "1px dashed var(--fp-line)",
              }}
            >
              Dev: sign in as a seeded Summerlake resident
            </button>
          ) : null}
        </form>
      )}
    </main>
  );
}
