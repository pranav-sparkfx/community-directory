import Link from "next/link";
import { redirect } from "next/navigation";
import { TabScreen } from "@/components/nav/TabScreen";
import { EmptyState } from "@/components/ui/EmptyState";
import { ServiceCard } from "@/components/services/ServiceCard";
import { createClient, getViewer } from "@/lib/supabase/server";
import type { ServiceCategory } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Figma screen 3 — Neighbourhood Services.
 *
 * The subtitle counts distinct NEIGHBOURS, not listings, because that is the
 * question a resident is actually asking: "how many people near me do this?"
 * Two listings from one household is one neighbour, not two.
 *
 * Only approved listings are counted. A pending listing is invisible here by
 * RLS, which is what makes "vet before it's public" real rather than a label.
 */
export default async function ServicesPage() {
  const supabase = await createClient();
  const { user, membership, isStaff } = await getViewer();
  if (!user) redirect("/sign-in");

  if (!membership || membership.verification_status !== "verified") {
    return (
      <TabScreen eyebrow="Front Porch" title="Neighbourhood Services">
        <EmptyState
          title="Not yet"
          detail="Services appear once an admin has confirmed you live here."
        />
      </TabScreen>
    );
  }

  const [{ data: community }, { data: categories }, { data: listings }] =
    await Promise.all([
      supabase.from("communities").select("name").eq("id", membership.community_id).single(),
      supabase.from("service_categories").select("*").order("sort_order"),
      supabase
        .from("services")
        .select("category, profile_id, availability")
        .eq("community_id", membership.community_id)
        .eq("status", "approved"),
    ]);

  const byCategory = new Map<string, { people: Set<string>; notes: Set<string> }>();
  for (const l of listings ?? []) {
    const entry = byCategory.get(l.category) ?? { people: new Set(), notes: new Set() };
    entry.people.add(l.profile_id);
    if (l.availability) entry.notes.add(l.availability);
    byCategory.set(l.category, entry);
  }

  const cats = (categories ?? []) as ServiceCategory[];

  return (
    <TabScreen
      eyebrow={community?.name ?? "Front Porch"}
      title="Neighbourhood Services"
      showAdmin={isStaff}
      action={
        <Link
          href="/services/new"
          className="fp-tap inline-flex items-center rounded-full px-4"
          style={{
            height: 36,
            background: "var(--fp-forest-wash)",
            color: "var(--fp-forest)",
            fontSize: "var(--fp-text-sm)",
            fontWeight: 600,
            whiteSpace: "nowrap",
          }}
        >
          Offer a service
        </Link>
      }
    >
      {cats.length === 0 ? (
        <EmptyState title="No categories yet" />
      ) : (
        <div style={{ display: "grid", gap: "var(--fp-space-3)" }}>
          {cats.map((c) => {
            const entry = byCategory.get(c.slug);
            const notes = entry ? [...entry.notes] : [];
            return (
              <ServiceCard
                key={c.slug}
                label={c.label}
                icon={c.icon}
                accent={c.accent}
                neighbourCount={entry?.people.size ?? 0}
                // One shared note reads as fact ("evenings"); several would be
                // a list, so we only show it when the whole category agrees.
                note={notes.length === 1 ? notes[0] : undefined}
                href={entry ? `/services/${c.slug}` : undefined}
              />
            );
          })}
        </div>
      )}
    </TabScreen>
  );
}
