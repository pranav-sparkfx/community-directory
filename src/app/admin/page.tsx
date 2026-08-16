import Link from "next/link";
import { redirect } from "next/navigation";
import { TabScreen } from "@/components/nav/TabScreen";
import { Icon, type IconName } from "@/components/ui/Icon";
import { createClient, getViewer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Stats = {
  residents: number;
  pending: number;
  homes_active: number;
  homes_occupied: number;
  new_residents_30d: number;
  services_pending: number;
  reports_open: number;
};

/**
 * Admin home.
 *
 * The numbers come from one RPC that refuses non-moderators, so a resident
 * who guesses this URL gets an empty object rather than a partial dashboard.
 * The layout leads with what is waiting on a person, not with the biggest
 * number — a queue of four claims matters more than a count of 128 homes.
 */
export default async function AdminPage() {
  const supabase = await createClient();
  const { user, membership, isStaff } = await getViewer();
  if (!user) redirect("/sign-in");
  if (!isStaff || !membership) redirect("/");

  const [{ data: statsData }, { data: community }] = await Promise.all([
    supabase.rpc("community_stats", { target_community: membership.community_id }),
    supabase.from("communities").select("name").eq("id", membership.community_id).maybeSingle(),
  ]);
  const s = (statsData ?? {}) as Partial<Stats>;

  const queues: {
    href: string;
    label: string;
    count: number;
    icon: IconName;
    detail: string;
    live: boolean;
  }[] = [
    {
      href: "/admin/verify",
      label: "Residency claims",
      count: s.pending ?? 0,
      icon: "shield",
      detail: "People waiting to be confirmed as residents",
      live: true,
    },
    {
      href: "/admin/services",
      label: "Service listings",
      count: s.services_pending ?? 0,
      icon: "services",
      detail: "Listings awaiting review before neighbours see them",
      live: true,
    },
    {
      href: "/admin/reports",
      label: "Reports",
      count: s.reports_open ?? 0,
      icon: "filter",
      detail: "Flagged profiles, listings and posts",
      live: true,
    },
  ];

  const vacant = (s.homes_active ?? 0) - (s.homes_occupied ?? 0);

  // Admins shape the community; moderators work its queues. The two links
  // that change who is in charge are therefore admin-only, and absent rather
  // than disabled for a moderator — the pages would redirect them anyway.
  const isAdmin = membership.role === "admin" || membership.role === "owner";
  const manage: { href: string; label: string; detail: string; icon: IconName }[] = [
    {
      href: "/admin/announcements",
      label: "Post to the neighbourhood",
      detail: "An announcement, an alert, or something for the calendar",
      icon: "announcements",
    },
    {
      href: "/admin/members",
      label: "Members and roles",
      detail: "Who is here, what they can do, and who no longer lives here",
      icon: "people",
    },
    ...(isAdmin
      ? [
          {
            href: "/admin/invites",
            label: "Invites",
            detail: "Links, emailed invites and codes to read out at a meeting",
            icon: "link" as IconName,
          },
          {
            href: "/admin/community",
            label: "Community settings",
            detail: "Name, who can find it, sub-communities and ownership",
            icon: "admin" as IconName,
          },
          {
            href: "/admin/audit",
            label: "Activity log",
            detail: "Every decision made here, and who made it",
            icon: "shield" as IconName,
          },
        ]
      : []),
  ];

  return (
    <TabScreen eyebrow={community?.name ?? "Front Porch"} title="Admin" showAdmin>
      {/* ---- what is waiting on you ---- */}
      <section className="mb-8">
        <h2
          style={{
            fontSize: "var(--fp-text-xs)",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--fp-ink-3)",
            fontWeight: 600,
            marginBottom: "var(--fp-space-3)",
          }}
        >
          Waiting on you
        </h2>
        <div style={{ display: "grid", gap: "var(--fp-space-2)" }}>
          {queues.map((q) => {
            const body = (
              <>
                <span
                  className="inline-flex shrink-0 items-center justify-center rounded-full"
                  style={{
                    width: 40,
                    height: 40,
                    background: q.count > 0 ? "var(--fp-clay-wash)" : "var(--fp-surface-sunk)",
                    color: q.count > 0 ? "var(--fp-clay)" : "var(--fp-ink-3)",
                  }}
                >
                  <Icon name={q.icon} size={19} />
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className="block"
                    style={{ fontSize: "var(--fp-text-base)", fontWeight: 500 }}
                  >
                    {q.label}
                    {q.live ? null : (
                      <span
                        style={{
                          fontSize: "var(--fp-text-xs)",
                          color: "var(--fp-ink-3)",
                          fontWeight: 500,
                          marginLeft: 6,
                        }}
                      >
                        soon
                      </span>
                    )}
                  </span>
                  <span
                    className="block"
                    style={{ fontSize: "var(--fp-text-sm)", color: "var(--fp-ink-3)" }}
                  >
                    {q.detail}
                  </span>
                </span>
                <span
                  className="shrink-0 tabular-nums"
                  style={{
                    fontFamily: "var(--fp-font-display)",
                    fontSize: "var(--fp-text-lg)",
                    color: q.count > 0 ? "var(--fp-clay)" : "var(--fp-ink-3)",
                  }}
                >
                  {q.count}
                </span>
              </>
            );

            return q.live ? (
              <Link
                key={q.href}
                href={q.href}
                className="fp-card fp-tap flex items-center gap-3.5 px-4 py-3"
              >
                {body}
              </Link>
            ) : (
              <div
                key={q.href}
                className="fp-card flex items-center gap-3.5 px-4 py-3"
                style={{ opacity: 0.6 }}
              >
                {body}
              </div>
            );
          })}
        </div>
      </section>

      {/* ---- the levers ---- */}
      <section className="mb-8">
        <h2
          style={{
            fontSize: "var(--fp-text-xs)",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--fp-ink-3)",
            fontWeight: 600,
            marginBottom: "var(--fp-space-3)",
          }}
        >
          Manage
        </h2>
        <div style={{ display: "grid", gap: "var(--fp-space-2)" }}>
          {manage.map((m) => (
            <Link
              key={m.href}
              href={m.href}
              className="fp-card fp-tap flex items-center gap-3.5 px-4 py-3"
            >
              <span
                className="inline-flex shrink-0 items-center justify-center rounded-full"
                style={{
                  width: 40,
                  height: 40,
                  background: "var(--fp-forest-wash)",
                  color: "var(--fp-forest)",
                }}
              >
                <Icon name={m.icon} size={19} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block" style={{ fontSize: "var(--fp-text-base)", fontWeight: 500 }}>
                  {m.label}
                </span>
                <span
                  className="block"
                  style={{ fontSize: "var(--fp-text-sm)", color: "var(--fp-ink-3)" }}
                >
                  {m.detail}
                </span>
              </span>
              <span className="shrink-0" style={{ color: "var(--fp-ink-3)" }}>
                <Icon name="chevron" size={18} />
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* ---- the neighbourhood at a glance ---- */}
      <section>
        <h2
          style={{
            fontSize: "var(--fp-text-xs)",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--fp-ink-3)",
            fontWeight: 600,
            marginBottom: "var(--fp-space-3)",
          }}
        >
          {community?.name ?? "This community"}
        </h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
            gap: "var(--fp-space-2)",
          }}
        >
          <Stat label="Confirmed residents" value={s.residents ?? 0} />
          <Stat label="New in 30 days" value={s.new_residents_30d ?? 0} accent />
          <Stat label="Homes on the map" value={s.homes_active ?? 0} />
          <Stat
            label="Homes with nobody confirmed"
            value={vacant > 0 ? vacant : 0}
            note={vacant > 0 ? "Nobody has claimed these yet" : undefined}
          />
        </div>
      </section>
    </TabScreen>
  );
}

function Stat({
  label,
  value,
  note,
  accent = false,
}: {
  label: string;
  value: number;
  note?: string;
  accent?: boolean;
}) {
  return (
    <div className="fp-card px-4 py-3.5">
      <p
        className="tabular-nums"
        style={{
          fontFamily: "var(--fp-font-display)",
          fontSize: "var(--fp-text-2xl)",
          lineHeight: 1,
          color: accent ? "var(--fp-clay)" : "var(--fp-ink)",
        }}
      >
        {value}
      </p>
      <p style={{ fontSize: "var(--fp-text-sm)", color: "var(--fp-ink-2)", marginTop: 6 }}>
        {label}
      </p>
      {note ? (
        <p style={{ fontSize: "var(--fp-text-xs)", color: "var(--fp-ink-3)", marginTop: 2 }}>
          {note}
        </p>
      ) : null}
    </div>
  );
}
