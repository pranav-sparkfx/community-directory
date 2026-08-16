import { redirect } from "next/navigation";
import { AnnouncementCard } from "@/components/announcements/AnnouncementCard";
import { TabScreen } from "@/components/nav/TabScreen";
import { EmptyState } from "@/components/ui/EmptyState";
import { createClient, getViewer } from "@/lib/supabase/server";
import { shortDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Figma screen 4 — Announcements.
 *
 * RLS already restricts this to verified members of the community and to
 * rows whose publish_at has passed, so there is no filtering here. A future
 * post is invisible rather than greyed out: a resident should not be able to
 * read an embargoed notice by inspecting the response.
 */
export default async function AnnouncementsPage() {
  const supabase = await createClient();
  const { user, membership, isStaff } = await getViewer();
  if (!user) redirect("/sign-in");

  if (!membership || membership.verification_status !== "verified") {
    return (
      <TabScreen eyebrow="Front Porch" title="Announcements">
        <EmptyState
          title="Not yet"
          detail="Announcements appear once an admin has confirmed you live here."
        />
      </TabScreen>
    );
  }

  const [{ data: community }, { data: announcements }, { data: events }] =
    await Promise.all([
      supabase.from("communities").select("name").eq("id", membership.community_id).single(),
      supabase
        .from("announcements")
        .select("id, kind, title, body, pinned, publish_at")
        .eq("community_id", membership.community_id)
        .order("pinned", { ascending: false })
        .order("publish_at", { ascending: false }),
      supabase
        .from("events")
        .select("id, title, location, starts_at")
        .eq("community_id", membership.community_id)
        .gte("starts_at", new Date().toISOString())
        .order("starts_at")
        .limit(3),
    ]);

  return (
    <TabScreen
      eyebrow={community?.name ?? "Front Porch"}
      title="Announcements"
      showAdmin={isStaff}
    >
      {events && events.length > 0 ? (
        <section style={{ marginBottom: "var(--fp-space-8)" }}>
          <h2 className="fp-eyebrow" style={{ marginBottom: "var(--fp-space-3)" }}>
            Coming up
          </h2>
          <div className="fp-card" style={{ overflow: "hidden" }}>
            {events.map((e, i) => (
              <div
                key={e.id}
                className="flex items-baseline justify-between gap-4 px-4 py-3"
                style={{
                  borderTop: i === 0 ? undefined : "1px solid var(--fp-line-soft)",
                }}
              >
                <div className="min-w-0">
                  <p
                    style={{
                      fontFamily: "var(--fp-font-display)",
                      fontSize: "var(--fp-text-md)",
                      fontWeight: 600,
                    }}
                  >
                    {e.title}
                  </p>
                  {e.location ? (
                    <p style={{ fontSize: "var(--fp-text-sm)", color: "var(--fp-ink-3)" }}>
                      {e.location}
                    </p>
                  ) : null}
                </div>
                <span
                  style={{
                    fontSize: "var(--fp-text-sm)",
                    color: "var(--fp-clay)",
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                  }}
                >
                  {shortDate(e.starts_at)}
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {!announcements || announcements.length === 0 ? (
        <EmptyState
          title="Nothing posted yet"
          detail="When your HOA board posts a notice, it will appear here."
        />
      ) : (
        <div style={{ display: "grid", gap: "var(--fp-space-3)" }}>
          {announcements.map((a) => (
            <AnnouncementCard
              key={a.id}
              kind={a.kind as "hoa" | "neighbor"}
              title={a.title}
              body={a.body}
              publishedAt={a.publish_at}
              pinned={a.pinned}
            />
          ))}
        </div>
      )}
    </TabScreen>
  );
}
