import { redirect } from "next/navigation";
import { TabScreen } from "@/components/nav/TabScreen";
import { createClient, getViewer } from "@/lib/supabase/server";
import { CommunityList, type Mine } from "./CommunityList";

export const dynamic = "force-dynamic";

/**
 * Every neighbourhood this person belongs to, and the two doors into another.
 *
 * The list comes from my_communities() rather than from a join here, because
 * the counts it carries (how many neighbours, which role) span tables that
 * RLS deliberately keeps a resident out of.
 */
export default async function CommunitiesPage() {
  const supabase = await createClient();
  const { user, membership, isStaff } = await getViewer();
  if (!user) redirect("/sign-in");

  const { data } = await supabase.rpc("my_communities");
  const mine = (data ?? []) as Mine[];

  const active = mine.find((c) => c.id === membership?.community_id) ?? null;

  // Proposing a sub-community only makes sense from inside one you are
  // verified in — an unverified member has not yet proved they live there.
  const canProposeUnder =
    active && membership?.verification_status === "verified"
      ? { id: active.id, name: active.name }
      : null;

  return (
    <TabScreen
      eyebrow="Front Porch"
      title="Neighbourhoods"
      showAdmin={isStaff}
    >
      <CommunityList
        mine={mine}
        activeId={membership?.community_id ?? null}
        canProposeUnder={canProposeUnder}
      />
    </TabScreen>
  );
}
