import Link from "next/link";
import { redirect } from "next/navigation";
import { TabScreen } from "@/components/nav/TabScreen";
import { AvatarMonogram } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icon";
import { StatusPill } from "@/components/ui/Controls";
import { PrivacyPanel } from "./PrivacyPanel";
import { createClient, getViewer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const STATUS_COPY: Record<string, { tone: string; title: string; detail: string }> = {
  unverified: {
    tone: "pending",
    title: "Your address is not confirmed",
    detail: "Claim your home and an admin will check it against the HOA records.",
  },
  pending: {
    tone: "pending",
    title: "Waiting on an admin",
    detail:
      "You have claimed an address. Until someone confirms it, the directory stays closed to you — and you stay out of it.",
  },
  rejected: {
    tone: "rejected",
    title: "We could not confirm your address",
    detail: "An admin did not match your claim to a home here. You can claim again.",
  },
};

/**
 * Profile and privacy.
 *
 * Verification state leads the page rather than sitting in a corner, because
 * it is the single fact that decides what the rest of the app does for this
 * person. Below it, the controls that decide what the app tells everyone else.
 */
export default async function YouPage() {
  const supabase = await createClient();
  const { user, membership, isStaff, memberships } = await getViewer();
  if (!user) redirect("/sign-in");

  const [{ data: profile }, { data: community }, { data: household }, { data: memberRow }] =
    await Promise.all([
      supabase.from("profiles").select("full_name, email, phone").eq("id", user.id).maybeSingle(),
      membership
        ? supabase.from("communities").select("name").eq("id", membership.community_id).maybeSingle()
        : Promise.resolve({ data: null }),
      membership?.household_id
        ? supabase
            .from("households")
            .select("address_line1, unit, city, state, postal_code")
            .eq("id", membership.household_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      membership?.household_id
        ? supabase
            .from("household_members")
            .select("is_listed, relationship, resident_since")
            .eq("household_id", membership.household_id)
            .eq("profile_id", user.id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

  const status = membership?.verification_status ?? "unverified";
  const verified = status === "verified";
  const name = profile?.full_name || user.email || "You";
  const notice = STATUS_COPY[status];

  return (
    <TabScreen eyebrow={community?.name ?? "Front Porch"} title="You" showAdmin={isStaff}>
      {/* ---- identity ---- */}
      <div className="fp-card mb-6 flex items-center gap-4 px-4 py-4">
        <AvatarMonogram name={name} size={52} />
        <div className="min-w-0 flex-1">
          <p style={{ fontFamily: "var(--fp-font-display)", fontSize: "var(--fp-text-lg)" }}>
            {name}
          </p>
          <p
            style={{
              fontSize: "var(--fp-text-sm)",
              color: "var(--fp-ink-3)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {household
              ? [household.address_line1, household.unit].filter(Boolean).join(" ")
              : (profile?.email ?? user.email)}
          </p>
        </div>
        {verified ? <StatusPill status="verified" /> : null}
      </div>

      {/* ---- verification state ---- */}
      {notice ? (
        <div
          className="mb-7 rounded-2xl px-4 py-4"
          style={{
            background:
              notice.tone === "rejected" ? "var(--fp-rejected-wash)" : "var(--fp-pending-wash)",
          }}
        >
          <p
            style={{
              fontFamily: "var(--fp-font-display)",
              fontSize: "var(--fp-text-md)",
              color: notice.tone === "rejected" ? "var(--fp-rejected)" : "var(--fp-pending)",
            }}
          >
            {notice.title}
          </p>
          <p
            style={{
              fontSize: "var(--fp-text-base)",
              color: "var(--fp-ink-2)",
              marginTop: 4,
              maxWidth: "48ch",
            }}
          >
            {notice.detail}
          </p>
          {status !== "pending" ? (
            <Link
              href="/join"
              className="fp-tap mt-3 inline-flex items-center gap-1.5 rounded-full px-4"
              style={{
                height: 38,
                background: "var(--fp-forest)",
                color: "var(--fp-ink-inverse)",
                fontSize: "var(--fp-text-sm)",
                fontWeight: 600,
              }}
            >
              Claim your address
              <Icon name="chevron" size={15} strokeWidth={2} />
            </Link>
          ) : null}
        </div>
      ) : null}

      {/* ---- privacy ---- */}
      {membership ? (
        <PrivacyPanel
          hasHousehold={Boolean(membership.household_id)}
          initial={{
            phone_vis: (membership.phone_vis ?? "text_only") as
              | "hidden"
              | "text_only"
              | "call_and_text",
            email_vis: (membership.email_vis ?? "hidden") as "hidden" | "visible",
            show_on_map: membership.show_on_map ?? true,
            show_in_directory: membership.show_in_directory ?? true,
            is_listed: memberRow?.is_listed ?? true,
          }}
        />
      ) : null}

      {/* ---- which neighbourhood ---- */}
      {/* Placed under privacy rather than in the tab bar: switching is
          occasional, and a fifth tab would push Admin off the edge on a
          375px screen. The current community is named so the link explains
          itself without being tapped. */}
      <Link
        href="/communities"
        className="fp-card fp-tap mb-4 flex items-center gap-3.5 px-4 py-3"
      >
        <span
          className="inline-flex shrink-0 items-center justify-center rounded-full"
          style={{ width: 38, height: 38, background: "var(--fp-surface-sunk)" }}
        >
          <Icon name="swap" size={18} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block" style={{ fontSize: "var(--fp-text-base)", fontWeight: 500 }}>
            {memberships.length > 1 ? "Switch neighbourhood" : "Your neighbourhoods"}
          </span>
          <span
            className="block truncate"
            style={{ fontSize: "var(--fp-text-sm)", color: "var(--fp-ink-3)" }}
          >
            {community?.name
              ? memberships.length > 1
                ? `Viewing ${community.name} · ${memberships.length} in total`
                : `Viewing ${community.name}`
              : "Join one, or start your own"}
          </span>
        </span>
        <span className="shrink-0" style={{ color: "var(--fp-ink-3)" }}>
          <Icon name="chevron" size={18} />
        </span>
      </Link>

      <form action="/auth/sign-out" method="post">
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
    </TabScreen>
  );
}
