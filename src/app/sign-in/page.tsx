"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Sign in — email and password.
 *
 * This replaced a magic link (decision D9 originally chose email links so there
 * was no password to remember). The link flow depended on mail actually being
 * delivered, and the seeded Summerlake residents live at @summerlake.test — a
 * reserved TLD that can never receive anything. On a deployed build that made
 * the front door impossible to open. A password has no such dependency, and it
 * also removes the redirect allow-list, the one-time token, and the expiry
 * window, each of which was its own way to fail.
 *
 * Accounts are usable the moment they are created — no confirmation step. That
 * is a deliberate product choice, not an oversight: an unconfirmed email is not
 * what keeps this directory safe. Membership is. A new account sees nothing
 * until it redeems an invite code, and stays invisible on the map until an
 * admin verifies the address, which is enforced in the database by RLS rather
 * than anywhere on this screen.
 */
export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * Where to land afterwards.
   *
   * Read from the query string at call time rather than through
   * useSearchParams, which would force this whole screen behind a Suspense
   * boundary for a value only ever needed inside an event handler. Only
   * same-site paths are honoured: an open redirect on a sign-in page is how a
   * phishing link borrows your domain.
   */
  function nextPath() {
    const raw = new URLSearchParams(window.location.search).get("next");
    return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const supabase = createClient();
    const credentials = { email, password };
    const { error: authError } = isCreating
      ? await supabase.auth.signUp(credentials)
      : await supabase.auth.signInWithPassword(credentials);

    setBusy(false);

    if (authError) {
      setError(friendlyMessage(authError.message));
      return;
    }

    // Deliberately no router.refresh() here. It re-requests the CURRENT route,
    // and the proxy answers an authenticated request for /sign-in with a
    // redirect to "/" — a second navigation that races this push and can land
    // someone on the map when they asked for /communities. The push alone is
    // enough: every gated page is force-dynamic and is rendered fresh by the
    // server under the cookies the sign-in just set.
    router.push(nextPath());
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-12">
      <p className="fp-eyebrow">Front Porch</p>
      <h1 style={{ fontSize: "var(--fp-text-2xl)", marginTop: 8 }}>
        Your neighbourhood, not a spreadsheet
      </h1>
      <p style={{ color: "var(--fp-ink-2)", marginTop: 12 }}>
        {isCreating
          ? "Create an account, then enter the invite code from your HOA."
          : "Sign in with the email your HOA has on file."}
      </p>

      <form onSubmit={submit} className="mt-8">
        <label htmlFor="email" style={LABEL}>
          Email address
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="mt-2 w-full rounded-xl px-4"
          style={FIELD}
        />

        <label htmlFor="password" style={{ ...LABEL, display: "block", marginTop: 16 }}>
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={6}
          autoComplete={isCreating ? "new-password" : "current-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={isCreating ? "At least 6 characters" : "Your password"}
          className="mt-2 w-full rounded-xl px-4"
          style={FIELD}
        />

        {error ? (
          <p
            role="alert"
            style={{
              color: "var(--fp-rejected)",
              fontSize: "var(--fp-text-sm)",
              marginTop: 10,
            }}
          >
            {error}
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
          {busy
            ? isCreating
              ? "Creating…"
              : "Signing in…"
            : isCreating
              ? "Create account"
              : "Sign in"}
        </button>

        <button
          type="button"
          onClick={() => {
            setIsCreating((v) => !v);
            setError(null);
          }}
          className="fp-tap mt-3 w-full rounded-xl"
          style={{
            height: "var(--fp-control-h)",
            background: "transparent",
            color: "var(--fp-ink-2)",
            fontSize: "var(--fp-text-sm)",
          }}
        >
          {isCreating
            ? "I already have an account"
            : "New here? Create an account"}
        </button>
      </form>
    </main>
  );
}

const LABEL: React.CSSProperties = {
  fontSize: "var(--fp-text-sm)",
  color: "var(--fp-ink-2)",
};

const FIELD: React.CSSProperties = {
  height: "var(--fp-control-h)",
  background: "var(--fp-surface)",
  border: "1px solid var(--fp-line)",
  fontSize: "var(--fp-text-base)",
};

/**
 * GoTrue's wording is written for whoever integrated it, not for a neighbour
 * standing on their porch with the wrong password.
 */
function friendlyMessage(raw: string): string {
  const message = raw.toLowerCase();
  if (message.includes("invalid login credentials")) {
    return "That email and password do not match. Check both, or create an account.";
  }
  if (message.includes("already registered")) {
    return "There is already an account with that email. Sign in instead.";
  }
  if (message.includes("password should be")) {
    return "Passwords need to be at least 6 characters.";
  }
  return raw;
}
