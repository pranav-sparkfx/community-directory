import Link from "next/link";
import { redirect } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { getViewer } from "@/lib/supabase/server";
import { CodeForm } from "./CodeForm";

export const dynamic = "force-dynamic";

/**
 * The landing for someone signed in but not yet in any neighbourhood.
 *
 * Three doors, in the order they are actually used: the code someone read
 * you, the public list, and starting your own. Anyone who already belongs
 * somewhere is sent home — this screen would only confuse them.
 */
export default async function WelcomePage() {
  const { user, memberships } = await getViewer();
  if (!user) redirect("/sign-in");
  if (memberships.length > 0) redirect("/");

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-6 py-14">
      <p className="fp-eyebrow">Front Porch</p>
      <h1
        style={{
          fontFamily: "var(--fp-font-display)",
          fontSize: "var(--fp-text-2xl)",
          marginTop: 8,
        }}
      >
        Find your neighbourhood
      </h1>
      <p style={{ color: "var(--fp-ink-2)", marginTop: 12, maxWidth: "42ch" }}>
        Most neighbourhoods here are invite-only, so the usual way in is a link or a
        code from whoever runs yours.
      </p>

      <CodeForm />

      <div className="my-7 flex items-center gap-3">
        <span className="h-px flex-1" style={{ background: "var(--fp-line)" }} />
        <span style={{ fontSize: "var(--fp-text-sm)", color: "var(--fp-ink-3)" }}>or</span>
        <span className="h-px flex-1" style={{ background: "var(--fp-line)" }} />
      </div>

      <div style={{ display: "grid", gap: "var(--fp-space-2)" }}>
        <Link href="/communities" className="fp-card fp-tap flex items-center gap-3.5 px-4 py-3.5">
          <span
            className="inline-flex shrink-0 items-center justify-center rounded-full"
            style={{ width: 38, height: 38, background: "var(--fp-surface-sunk)" }}
          >
            <Icon name="search" size={18} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block" style={{ fontSize: "var(--fp-text-base)", fontWeight: 500 }}>
              Search public neighbourhoods
            </span>
            <span className="block" style={{ fontSize: "var(--fp-text-sm)", color: "var(--fp-ink-3)" }}>
              For the ones that chose to be findable
            </span>
          </span>
          <Icon name="chevron" size={18} />
        </Link>

        <Link href="/communities" className="fp-card fp-tap flex items-center gap-3.5 px-4 py-3.5">
          <span
            className="inline-flex shrink-0 items-center justify-center rounded-full"
            style={{ width: 38, height: 38, background: "var(--fp-forest-wash)", color: "var(--fp-forest)" }}
          >
            <Icon name="plus" size={18} strokeWidth={2} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block" style={{ fontSize: "var(--fp-text-base)", fontWeight: 500 }}>
              Start your own
            </span>
            <span className="block" style={{ fontSize: "var(--fp-text-sm)", color: "var(--fp-ink-3)" }}>
              You will own it, and can invite your neighbours today
            </span>
          </span>
          <Icon name="chevron" size={18} />
        </Link>
      </div>

      <form action="/auth/sign-out" method="post" className="mt-8">
        <button
          type="submit"
          className="fp-tap w-full rounded-xl"
          style={{
            border: "1px solid var(--fp-line)",
            color: "var(--fp-ink-2)",
            fontSize: "var(--fp-text-base)",
            fontWeight: 500,
          }}
        >
          Sign out
        </button>
      </form>
    </main>
  );
}
