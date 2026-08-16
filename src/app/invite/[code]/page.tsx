import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { createClient } from "@/lib/supabase/server";
import { RedeemPanel } from "./RedeemPanel";

export const dynamic = "force-dynamic";

type Preview = {
  community_id: string;
  community_name: string;
  parent_name: string | null;
  role: string;
  address: string | null;
  invited_by: string;
  email: string | null;
  state: "active" | "revoked" | "expired" | "used up";
};

const DEAD: Record<string, { title: string; detail: string }> = {
  revoked: {
    title: "This invite was withdrawn",
    detail: "An admin revoked it. Ask whoever sent it for a new one.",
  },
  expired: {
    title: "This invite has expired",
    detail: "Invites are time-limited on purpose. Ask for a fresh link.",
  },
  "used up": {
    title: "This invite has already been used",
    detail: "Single-use invites work once. Ask for one of your own.",
  },
};

/**
 * The door.
 *
 * This is the one screen a signed-out stranger can see, and it shows exactly
 * three things: which neighbourhood, who asked them, and whether the code
 * still works. No addresses, no residents, no map — the code is a credential,
 * not an entitlement, and preview_invite() is written to hand over nothing
 * that would be worth harvesting codes for.
 */
export default async function InvitePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const supabase = await createClient();

  const [{ data }, { data: auth }] = await Promise.all([
    supabase.rpc("preview_invite", { invite_code: code }),
    supabase.auth.getUser(),
  ]);

  const invite = data as Preview | null;
  const signedIn = Boolean(auth?.user);

  return (
    <main
      className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-6"
      style={{ paddingBlock: "var(--fp-space-8)" }}
    >
      <div className="fp-card px-6 py-7">
        {!invite || invite.state !== "active" ? (
          <>
            <span
              className="mb-4 inline-flex items-center justify-center rounded-full"
              style={{
                width: 44,
                height: 44,
                background: "var(--fp-rejected-wash)",
                color: "var(--fp-rejected)",
              }}
            >
              <Icon name="close" size={22} strokeWidth={2} />
            </span>
            <h1 style={{ fontSize: "var(--fp-text-xl)" }}>
              {invite
                ? (DEAD[invite.state]?.title ?? "This invite is no longer valid")
                : "We do not recognise that code"}
            </h1>
            <p
              style={{
                fontSize: "var(--fp-text-base)",
                color: "var(--fp-ink-2)",
                marginTop: "var(--fp-space-2)",
              }}
            >
              {invite
                ? (DEAD[invite.state]?.detail ?? "Ask whoever sent it for a new one.")
                : "Check the code for typos — the letters I, O and the digits 0 and 1 are never used, so a stray one is usually the culprit."}
            </p>
            <Link
              href="/communities"
              className="fp-tap mt-5 flex w-full items-center justify-center rounded-xl"
              style={{
                border: "1px solid var(--fp-line)",
                fontSize: "var(--fp-text-base)",
                fontWeight: 600,
              }}
            >
              Find a neighbourhood instead
            </Link>
          </>
        ) : (
          <>
            <p className="fp-eyebrow">You have been invited to</p>
            {invite.parent_name ? (
              <p
                style={{
                  fontSize: "var(--fp-text-sm)",
                  color: "var(--fp-ink-3)",
                  marginTop: 8,
                }}
              >
                {invite.parent_name} ›
              </p>
            ) : null}
            <h1
              style={{
                fontFamily: "var(--fp-font-display)",
                fontSize: "var(--fp-text-2xl)",
                marginTop: invite.parent_name ? 2 : 8,
              }}
            >
              {invite.community_name}
            </h1>

            <dl className="mt-5" style={{ display: "grid", gap: "var(--fp-space-2)" }}>
              <Row label="Invited by" value={invite.invited_by} />
              {invite.address ? <Row label="Your home" value={invite.address} /> : null}
              {invite.role !== "resident" ? (
                <Row label="Joining as" value={invite.role} />
              ) : null}
            </dl>

            <div className="mt-6">
              <RedeemPanel code={code} address={invite.address} signedIn={signedIn} />
            </div>
          </>
        )}
      </div>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="flex items-baseline justify-between gap-4 py-2"
      style={{ borderBottom: "1px solid var(--fp-line)" }}
    >
      <dt style={{ fontSize: "var(--fp-text-sm)", color: "var(--fp-ink-3)" }}>{label}</dt>
      <dd
        className="text-right"
        style={{ fontSize: "var(--fp-text-base)", fontWeight: 500, textTransform: "capitalize" }}
      >
        {value}
      </dd>
    </div>
  );
}
