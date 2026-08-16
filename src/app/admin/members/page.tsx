import { redirect } from "next/navigation";
import { TabScreen } from "@/components/nav/TabScreen";
import { createClient, getViewer } from "@/lib/supabase/server";
import { MemberList, type Member } from "./MemberList";

export const dynamic = "force-dynamic";

const RANK: Record<string, number> = { resident: 1, moderator: 2, admin: 3, owner: 4 };

/**
 * Who is in this community, and what they are allowed to do.
 *
 * Moderators can see the list — they need it to recognise the names behind
 * reports — but the role and removal controls only appear for someone who
 * out-ranks the row, which in practice means admins and the owner.
 */
export default async function MembersPage() {
  const supabase = await createClient();
  const { user, membership, isStaff } = await getViewer();
  if (!user) redirect("/sign-in");
  if (!isStaff || !membership) redirect("/");

  const [{ data }, { data: community }] = await Promise.all([
    supabase.rpc("community_members", {
      target_community: membership.community_id,
      q: "",
      role_filter: "all",
    }),
    supabase
      .from("communities")
      .select("name")
      .eq("id", membership.community_id)
      .maybeSingle(),
  ]);

  return (
    <TabScreen eyebrow={community?.name ?? "Community"} title="Members" showAdmin>
      <MemberList
        communityId={membership.community_id}
        initial={(data ?? []) as Member[]}
        viewerRank={RANK[membership.role] ?? 1}
      />
    </TabScreen>
  );
}
