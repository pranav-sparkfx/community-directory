import { redirect } from "next/navigation";
import { TabScreen } from "@/components/nav/TabScreen";
import { createClient, getViewer } from "@/lib/supabase/server";
import { Composer, type Ev, type Notice } from "./Composer";

export const dynamic = "force-dynamic";

/**
 * Post to the neighbourhood.
 *
 * Open to moderators as well as admins — a moderator posting "skip in the
 * cul-de-sac on Saturday" is the job — but the association's own voice is
 * gated to admins by a trigger, and the composer only offers that choice to
 * someone who can actually use it.
 */
export default async function AnnouncementsAdminPage() {
  const supabase = await createClient();
  const { user, membership, isStaff } = await getViewer();
  if (!user) redirect("/sign-in");
  if (!isStaff || !membership) redirect("/");

  const [{ data: community }, { data: notices }, { data: events }] = await Promise.all([
    supabase.from("communities").select("name").eq("id", membership.community_id).maybeSingle(),
    supabase
      .from("announcements")
      .select("id, kind, title, body, pinned, publish_at")
      .eq("community_id", membership.community_id)
      .order("pinned", { ascending: false })
      .order("publish_at", { ascending: false })
      .limit(30),
    supabase
      .from("events")
      .select("id, title, location, starts_at")
      .eq("community_id", membership.community_id)
      .gte("starts_at", new Date().toISOString())
      .order("starts_at")
      .limit(20),
  ]);

  return (
    <TabScreen eyebrow={community?.name ?? "Community"} title="Post" showAdmin>
      <Composer
        notices={(notices ?? []) as Notice[]}
        events={(events ?? []) as Ev[]}
        canPostOfficial={membership.role === "admin" || membership.role === "owner"}
      />
    </TabScreen>
  );
}
