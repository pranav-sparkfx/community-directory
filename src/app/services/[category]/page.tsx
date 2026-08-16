import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AvatarMonogram } from "@/components/ui/Avatar";
import { TabScreen } from "@/components/nav/TabScreen";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { ReportButton } from "@/components/moderation/ReportButton";
import { CATEGORY_ICONS } from "@/components/ui/ServiceTag";
import { createClient, getViewer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Providers within one service category.
 *
 * Each row is a neighbour offering the service. Names come from `profiles`
 * through the join, which RLS permits only for verified members — and the
 * contact route is deliberately the household card rather than a phone
 * number rendered here, so redaction happens in exactly one place.
 */
export default async function ServiceCategoryPage({
  params,
}: {
  params: Promise<{ category: string }>;
}) {
  const { category } = await params;
  const supabase = await createClient();
  const { user, membership, isStaff } = await getViewer();
  if (!user) redirect("/sign-in");
  if (!membership || membership.verification_status !== "verified") redirect("/services");

  const [{ data: cat }, { data: listings }] = await Promise.all([
    supabase.from("service_categories").select("*").eq("slug", category).maybeSingle(),
    supabase
      .from("services")
      .select("id, title, description, availability, rate_note, household_id, profile_id")
      .eq("community_id", membership.community_id)
      .eq("category", category)
      .eq("status", "approved")
      .order("created_at"),
  ]);

  if (!cat) notFound();

  // Provider names, fetched separately: `profiles` is self-read only, so the
  // display name comes from household_members, which is directory-gated.
  const householdIds = [...new Set((listings ?? []).map((l) => l.household_id).filter(Boolean))];
  const { data: members } = householdIds.length
    ? await supabase
        .from("household_members")
        .select("household_id, display_name, is_primary, profile_id")
        .in("household_id", householdIds as string[])
        .eq("is_primary", true)
    : { data: [] };

  const { data: households } = householdIds.length
    ? await supabase
        .from("households")
        .select("id, address_line1")
        .in("id", householdIds as string[])
    : { data: [] };

  const addressFor = new Map((households ?? []).map((h) => [h.id, h.address_line1]));
  // Only real names land here. `display_name` is null for most rows, and an
  // earlier `?? ""` turned that into a falsy value that fell through to the
  // address — so the row rendered the address twice and drew a monogram out
  // of a house number ("1R").
  const nameFor = new Map(
    (members ?? [])
      .filter((m) => (m.display_name ?? "").trim().length > 0)
      .map((m) => [m.household_id, m.display_name as string]),
  );

  return (
    <TabScreen eyebrow="Neighbourhood Services" title={cat.label} showAdmin={isStaff}>
      <Link
        href="/services"
        className="mb-5 inline-flex items-center gap-1.5"
        style={{ color: "var(--fp-forest)", fontSize: "var(--fp-text-sm)" }}
      >
        <span style={{ transform: "rotate(180deg)", display: "inline-flex" }}>
          <Icon name="chevron" size={16} strokeWidth={2} />
        </span>
        All services
      </Link>

      {!listings || listings.length === 0 ? (
        <EmptyState
          title={`No one offers ${cat.label.toLowerCase()} yet`}
          detail="If you do, you can add a listing from your profile. An admin reviews it before neighbours see it."
        />
      ) : (
        <div style={{ display: "grid", gap: "var(--fp-space-3)" }}>
          {listings.map((l) => {
            const address = l.household_id ? addressFor.get(l.household_id) : undefined;
            const name = l.household_id ? nameFor.get(l.household_id) : undefined;
            return (
              <article key={l.id} className="fp-card px-4 py-4">
                <div className="flex items-start gap-3.5">
                  <span
                    className="inline-flex shrink-0 items-center justify-center rounded-full"
                    style={{
                      width: 42,
                      height: 42,
                      background:
                        cat.accent === "clay" ? "var(--fp-clay-wash)" : "var(--fp-forest-wash)",
                      color: cat.accent === "clay" ? "var(--fp-clay)" : "var(--fp-forest)",
                    }}
                  >
                    <Icon name={CATEGORY_ICONS[cat.icon] ?? "paw"} size={20} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2 style={{ fontSize: "var(--fp-text-md)" }}>{l.title}</h2>
                    {l.description ? (
                      <p
                        style={{
                          fontSize: "var(--fp-text-base)",
                          color: "var(--fp-ink-2)",
                          marginTop: 4,
                        }}
                      >
                        {l.description}
                      </p>
                    ) : null}

                    <div
                      className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1"
                      style={{ fontSize: "var(--fp-text-sm)", color: "var(--fp-ink-3)" }}
                    >
                      {name ? (
                        <span className="inline-flex items-center gap-1.5">
                          <AvatarMonogram name={name} size={20} />
                          {name}
                        </span>
                      ) : null}
                      {address ? <span>{address}</span> : null}
                      {!name && !address ? <span>A neighbour</span> : null}
                      {l.availability ? <span>· {l.availability}</span> : null}
                      {l.rate_note ? <span>· {l.rate_note}</span> : null}
                    </div>

                    <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                      {l.household_id ? (
                        <Link
                          href={`/?household=${l.household_id}`}
                          className="inline-flex items-center gap-1.5"
                          style={{
                            color: "var(--fp-forest)",
                            fontSize: "var(--fp-text-sm)",
                            fontWeight: 600,
                          }}
                        >
                          See contact options
                          <Icon name="chevron" size={15} strokeWidth={2} />
                        </Link>
                      ) : (
                        <span />
                      )}
                      {/* Author's own listing carries no report control: the
                          RPC would accept it, but offering someone a way to
                          report themselves is a UI that has stopped thinking. */}
                      {l.profile_id === user.id ? null : (
                        <ReportButton targetType="service" targetId={l.id} />
                      )}
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </TabScreen>
  );
}
