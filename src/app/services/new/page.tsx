import { redirect } from "next/navigation";
import { TabScreen } from "@/components/nav/TabScreen";
import { ListingForm } from "./ListingForm";
import { createClient, getViewer } from "@/lib/supabase/server";
import type { ServiceCategory } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function NewListingPage() {
  const supabase = await createClient();
  const { user, membership, isStaff } = await getViewer();
  if (!user) redirect("/sign-in");
  if (!membership || membership.verification_status !== "verified") redirect("/services");

  const { data: categories } = await supabase
    .from("service_categories")
    .select("*")
    .order("sort_order");

  return (
    <TabScreen eyebrow="Neighbourhood Services" title="Offer a service" showAdmin={isStaff}>
      <p style={{ color: "var(--fp-ink-2)", maxWidth: "58ch", marginBottom: "var(--fp-space-6)" }}>
        Tell your neighbours what you can help with. An admin reviews every
        listing before it appears, so it will not be visible right away.
      </p>
      <ListingForm categories={(categories ?? []) as ServiceCategory[]} />
    </TabScreen>
  );
}
