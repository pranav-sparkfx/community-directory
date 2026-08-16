import { redirect } from "next/navigation";
import { TabScreen } from "@/components/nav/TabScreen";
import { EmptyState } from "@/components/ui/EmptyState";
import { ClaimForm } from "./ClaimForm";
import { createClient, getViewer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Claim your address.
 *
 * The community is resolved from an existing membership first (someone who
 * was invited already has one) and falls back to the deployment's default
 * community, which is what a resident reaching this page cold will want.
 */
export default async function JoinPage() {
  const supabase = await createClient();
  const { user, membership, isStaff } = await getViewer();
  if (!user) redirect("/sign-in");

  // A verified member is NOT redirected away: people move within a
  // neighbourhood, and a change of address is the same claim, reviewed the
  // same way. They keep their directory access while it is pending.
  const moving = membership?.verification_status === "verified";

  const communityId =
    membership?.community_id ?? process.env.NEXT_PUBLIC_DEFAULT_COMMUNITY_ID ?? "";

  const { data: community } = communityId
    ? await supabase.from("communities").select("name").eq("id", communityId).maybeSingle()
    : { data: null };

  if (!communityId || !community) {
    return (
      <TabScreen eyebrow="Front Porch" title="Join a neighbourhood" showAdmin={isStaff}>
        <EmptyState
          title="No neighbourhood yet"
          detail="You need an invite from an admin, or a link to a public community, before you can claim an address."
        />
      </TabScreen>
    );
  }

  return (
    <TabScreen
      eyebrow={community.name}
      title={moving ? "Change your address" : "Claim your address"}
      showAdmin={isStaff}
    >
      <p style={{ color: "var(--fp-ink-2)", maxWidth: "54ch", marginBottom: "var(--fp-space-6)" }}>
        {moving
          ? "Moved within the neighbourhood? Tell us the new home. Your listing stays live until an admin confirms the change, then it moves with you."
          : "Tell us which home is yours. Once an admin confirms it, the map, the directory and the services board open up — and your neighbours can find you the same way."}
      </p>
      <ClaimForm communityId={communityId} communityName={community.name} />
    </TabScreen>
  );
}
