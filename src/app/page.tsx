import { redirect } from "next/navigation";
import { HomeView } from "@/components/home/HomeView";
import { TabBar } from "@/components/nav/TabBar";
import { createClient, getViewer } from "@/lib/supabase/server";
import type { Community, HouseholdCollection, ServiceCategory } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Figma screen 1 — Home, browsing.
 *
 * Everything here is fetched server-side under the caller's own session, so
 * RLS applies. A member awaiting verification reaches this page and sees an
 * empty map, which is correct: unverified means invisible, in both directions.
 */
export default async function HomePage() {
  const supabase = await createClient();
  const { user, membership, isStaff } = await getViewer();

  if (!user) redirect("/sign-in");

  // Not a dead end: this used to say "ask a neighbour" and stop, which left
  // someone who HAD been given a code with nowhere to type it.
  if (!membership) redirect("/welcome");

  const communityId = membership.community_id;

  const [{ data: community }, { data: geo }, { data: categories }, { data: newCount }] =
    await Promise.all([
      supabase
        .from("communities")
        .select("id, name, slug, description, center_lng, center_lat, default_zoom")
        .eq("id", communityId)
        .single(),
      supabase.rpc("visible_households", { target_community: communityId }),
      supabase.from("service_categories").select("*").order("sort_order"),
      // Counted in SQL rather than from a cutoff computed here: the web
      // server and the database do not share a clock, and this badge has to
      // agree with the identical figure on the admin dashboard.
      supabase.rpc("new_neighbour_count", { target_community: communityId }),
    ]);

  if (!community) redirect("/sign-in");

  if (membership.verification_status !== "verified") {
    return (
      <>
        <main className="mx-auto max-w-md px-5 py-16">
          <p className="fp-eyebrow">{community.name}</p>
          <h1 style={{ fontSize: "var(--fp-text-2xl)", marginTop: 8 }}>
            Waiting on a neighbour to confirm you live here
          </h1>
          <p style={{ color: "var(--fp-ink-2)", marginTop: 12 }}>
            The directory stays hidden until an admin confirms your address.
            That check is the reason it is safe to list real homes and phone
            numbers here at all.
          </p>
        </main>
        <TabBar showAdmin={false} />
      </>
    );
  }

  return (
    <>
      <HomeView
        community={community as unknown as Community}
        initialData={(geo as unknown as HouseholdCollection) ?? { type: "FeatureCollection", features: [] }}
        categories={(categories ?? []) as ServiceCategory[]}
        newResidentCount={newCount ?? 0}
      />
      <TabBar showAdmin={isStaff} />
    </>
  );
}
