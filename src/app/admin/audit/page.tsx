import { redirect } from "next/navigation";
import { TabScreen } from "@/components/nav/TabScreen";
import { EmptyState } from "@/components/ui/EmptyState";
import { createClient, getViewer } from "@/lib/supabase/server";
import { relativeDay } from "@/lib/utils";

export const dynamic = "force-dynamic";

type Entry = {
  id: string;
  action: string;
  target_type: string;
  actor: string;
  diff: Record<string, unknown>;
  created_at: string;
};

/**
 * Every admin action against a resident record, in plain English.
 *
 * Admin-only, and read-only by construction: audit_log has no client INSERT
 * policy at all, so rows are written exclusively by SECURITY DEFINER routines
 * and triggers. An actor cannot forge an entry, and cannot delete their own.
 *
 * The phrasing map exists because "membership.update" is not an answer to
 * "what happened to my neighbour's account". Anything unmapped falls through
 * to its raw action name rather than being hidden — an unfamiliar line in an
 * audit trail is information, not a rendering bug to suppress.
 */
const PHRASING: Record<string, (d: Record<string, unknown>) => string> = {
  "join_request.approve": () => "confirmed a residency claim",
  "join_request.reject": () => "declined a residency claim",
  "join_request.match": () => "matched a claim to an address",
  "membership.update": () => "changed a membership",
  "member.role": (d) => `changed a role from ${d.from} to ${d.to}`,
  "member.remove": () => "removed a member",
  "community.create": (d) => `created ${d.name}`,
  "community.transfer": () => "handed over ownership",
  "community_request.create": (d) => `asked to start ${d.name}`,
  "community_request.approve": (d) => `approved ${d.name}`,
  "community_request.reject": (d) => `declined ${d.name}`,
  "invite.create": (d) => `created an invite (as ${d.role})`,
  "invite.revoke": () => "revoked an invite",
  "invite.redeem": () => "accepted an invite",
  "announcement.post": (d) => `posted “${d.title}”`,
  "service.approve": (d) => `published “${d.title}”`,
  "service.reject": (d) => `turned down “${d.title}”`,
  "report.remove": () => "took down reported content",
  "report.dismiss": () => "dismissed a report",
};

export default async function AuditPage() {
  const supabase = await createClient();
  const { user, membership } = await getViewer();
  if (!user) redirect("/sign-in");
  if (!membership || (membership.role !== "admin" && membership.role !== "owner")) {
    redirect("/admin");
  }

  const [{ data }, { data: community }] = await Promise.all([
    supabase.rpc("audit_feed", { target_community: membership.community_id, limit_n: 100 }),
    supabase.from("communities").select("name").eq("id", membership.community_id).maybeSingle(),
  ]);

  const entries = (data ?? []) as Entry[];

  return (
    <TabScreen eyebrow={community?.name ?? "Community"} title="Activity log" showAdmin>
      <p
        style={{
          color: "var(--fp-ink-2)",
          maxWidth: "54ch",
          marginBottom: "var(--fp-space-6)",
        }}
      >
        Every decision an admin or moderator has made here. Nothing on this page can be
        written or deleted from the app — the entries are made by the database itself.
      </p>

      {entries.length === 0 ? (
        <EmptyState title="Nothing yet" detail="Admin actions will be recorded here." />
      ) : (
        <ol>
          {entries.map((e, i) => (
            <li
              key={e.id}
              className="flex gap-3.5 py-3"
              style={{
                borderBottom: i === entries.length - 1 ? "none" : "1px solid var(--fp-line)",
              }}
            >
              <span
                aria-hidden="true"
                className="mt-2 shrink-0 rounded-full"
                style={{ width: 7, height: 7, background: "var(--fp-ink-3)" }}
              />
              <span className="min-w-0 flex-1">
                <span className="block" style={{ fontSize: "var(--fp-text-base)" }}>
                  <strong style={{ fontWeight: 600 }}>{e.actor}</strong>{" "}
                  {PHRASING[e.action]?.(e.diff ?? {}) ?? e.action}
                </span>
                <span
                  className="block"
                  style={{
                    fontSize: "var(--fp-text-xs)",
                    color: "var(--fp-ink-3)",
                    marginTop: 2,
                  }}
                >
                  {relativeDay(e.created_at)}
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </TabScreen>
  );
}
