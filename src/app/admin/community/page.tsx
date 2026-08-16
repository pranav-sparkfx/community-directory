import { redirect } from "next/navigation";
import { TabScreen } from "@/components/nav/TabScreen";
import { createClient, getViewer } from "@/lib/supabase/server";
import {
  SettingsPanel,
  type Candidate,
  type Child,
  type Community,
  type Request,
} from "./SettingsPanel";

export const dynamic = "force-dynamic";

/**
 * The community itself: what it is called, who can find it, what sits inside
 * it, and who owns it.
 *
 * Moderators are turned away here — they moderate content, not the shape of
 * the community — so this page requires admin or above.
 */
export default async function CommunitySettingsPage() {
  const supabase = await createClient();
  const { user, membership } = await getViewer();
  if (!user) redirect("/sign-in");
  if (!membership || (membership.role !== "admin" && membership.role !== "owner")) {
    redirect("/admin");
  }

  const [{ data: community }, { data: kids }, { data: reqs }, { data: members }] =
    await Promise.all([
      supabase
        .from("communities")
        .select("id, name, description, visibility, owner_id")
        .eq("id", membership.community_id)
        .maybeSingle(),
      supabase.rpc("child_communities", { target_community: membership.community_id }),
      supabase.rpc("community_request_queue", {
        target_community: membership.community_id,
      }),
      supabase.rpc("community_members", {
        target_community: membership.community_id,
        q: "",
        role_filter: "all",
      }),
    ]);

  if (!community) redirect("/admin");

  // Only someone already carrying real responsibility should appear in the
  // hand-over list: transfer_ownership refuses anyone unverified anyway, and
  // a list of 128 residents would make the dangerous option feel casual.
  const candidates = ((members ?? []) as (Candidate & { status: string; is_self: boolean })[])
    .filter((m) => !m.is_self && m.status === "verified" && m.role !== "resident")
    .map(({ profile_id, name, role }) => ({ profile_id, name, role }));

  return (
    <TabScreen eyebrow="Admin" title="Community" showAdmin>
      <SettingsPanel
        community={community as Community}
        childCommunities={(kids ?? []) as Child[]}
        requests={(reqs ?? []) as Request[]}
        candidates={candidates}
        isOwner={community.owner_id === user.id}
      />
    </TabScreen>
  );
}
