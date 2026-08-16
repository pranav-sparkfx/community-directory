import { redirect } from "next/navigation";
import { TabScreen } from "@/components/nav/TabScreen";
import { createClient, getViewer } from "@/lib/supabase/server";
import { ListingQueue, type Pending } from "./ListingQueue";

export const dynamic = "force-dynamic";

/**
 * Vet before it is public.
 *
 * A pending listing is already invisible to neighbours by RLS, so nothing
 * leaks while it sits here — this screen decides when it stops being hidden,
 * not whether it was hidden in the first place.
 */
export default async function ServiceQueuePage() {
  const supabase = await createClient();
  const { user, membership, isStaff } = await getViewer();
  if (!user) redirect("/sign-in");
  if (!isStaff || !membership) redirect("/");

  const [{ data }, { data: community }] = await Promise.all([
    supabase.rpc("moderation_queue", { target_community: membership.community_id }),
    supabase.from("communities").select("name").eq("id", membership.community_id).maybeSingle(),
  ]);

  return (
    <TabScreen eyebrow={community?.name ?? "Community"} title="Service listings" showAdmin>
      <p
        style={{
          color: "var(--fp-ink-2)",
          maxWidth: "54ch",
          marginBottom: "var(--fp-space-6)",
        }}
      >
        Nobody can see these but you until they are published. Turning one down tells
        the author why, so they can fix it rather than repost it.
      </p>
      <ListingQueue initial={(data ?? []) as Pending[]} />
    </TabScreen>
  );
}
