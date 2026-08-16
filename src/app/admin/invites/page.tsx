import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { TabScreen } from "@/components/nav/TabScreen";
import { createClient, getViewer } from "@/lib/supabase/server";
import { InvitePanel, type Invite } from "./InvitePanel";

export const dynamic = "force-dynamic";

/**
 * Invites.
 *
 * The origin is read from the request rather than from an env var so the
 * copied link works on whatever host the admin is actually on — localhost,
 * a preview deploy, or the real domain — without a build-time constant that
 * would be wrong on two of the three.
 */
export default async function InvitesPage() {
  const supabase = await createClient();
  const { user, membership, isStaff } = await getViewer();
  if (!user) redirect("/sign-in");
  if (!isStaff || !membership) redirect("/");

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");

  const [{ data }, { data: community }] = await Promise.all([
    supabase.rpc("community_invites", { target_community: membership.community_id }),
    supabase
      .from("communities")
      .select("name")
      .eq("id", membership.community_id)
      .maybeSingle(),
  ]);

  return (
    <TabScreen eyebrow={community?.name ?? "Community"} title="Invites" showAdmin>
      <p
        style={{
          color: "var(--fp-ink-2)",
          maxWidth: "54ch",
          marginBottom: "var(--fp-space-6)",
        }}
      >
        Every invite expires in 30 days and can be revoked at any time. Codes never use
        the letters I or O, or the digits 0 and 1 — so one read aloud at a meeting
        survives being written down.
      </p>
      <InvitePanel
        communityId={membership.community_id}
        initial={(data ?? []) as Invite[]}
        canGrantModerator={membership.role === "admin" || membership.role === "owner"}
        canGrantAdmin={membership.role === "owner"}
        origin={`${proto}://${host}`}
      />
    </TabScreen>
  );
}
