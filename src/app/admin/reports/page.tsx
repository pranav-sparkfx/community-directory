import { redirect } from "next/navigation";
import { TabScreen } from "@/components/nav/TabScreen";
import { createClient, getViewer } from "@/lib/supabase/server";
import { ReportQueue, type Report } from "./ReportQueue";

export const dynamic = "force-dynamic";

/**
 * What neighbours have flagged.
 *
 * One row per reported thing, not per report: three people flagging the same
 * listing is one decision, and resolving it answers all three.
 */
export default async function ReportsPage() {
  const supabase = await createClient();
  const { user, membership, isStaff } = await getViewer();
  if (!user) redirect("/sign-in");
  if (!isStaff || !membership) redirect("/");

  const [{ data }, { data: community }] = await Promise.all([
    supabase.rpc("reports_queue", { target_community: membership.community_id }),
    supabase.from("communities").select("name").eq("id", membership.community_id).maybeSingle(),
  ]);

  // reports_queue returns one row per report; collapse to one per target so a
  // pile-on reads as a single decision. `also_reported_by` already carries
  // the count, so nothing is lost.
  const rows = ((data ?? []) as Report[]).filter(
    (r, i, all) => all.findIndex((o) => o.target_id === r.target_id) === i,
  );

  return (
    <TabScreen eyebrow={community?.name ?? "Community"} title="Reports" showAdmin>
      <ReportQueue initial={rows} />
    </TabScreen>
  );
}
