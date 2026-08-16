import Link from "next/link";
import { redirect } from "next/navigation";
import { TabScreen } from "@/components/nav/TabScreen";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { ClaimCard, type QueueRow } from "./ClaimCard";
import { createClient, getViewer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * The residency queue.
 *
 * Everything on this page comes from verification_queue(), which is the only
 * way an admin can read an applicant's name at all — `profiles` is self-read
 * only. Asking to join is what hands the name over.
 */
export default async function VerifyPage() {
  const supabase = await createClient();
  const { user, membership, isStaff } = await getViewer();
  if (!user) redirect("/sign-in");
  if (!isStaff || !membership) redirect("/");

  const { data } = await supabase.rpc("verification_queue", {
    target_community: membership.community_id,
  });
  const rows = (data ?? []) as QueueRow[];

  return (
    <TabScreen eyebrow="Admin" title="Residency claims" showAdmin={isStaff}>
      <Link
        href="/admin"
        className="mb-5 inline-flex items-center gap-1.5"
        style={{ color: "var(--fp-forest)", fontSize: "var(--fp-text-sm)" }}
      >
        <span style={{ transform: "rotate(180deg)", display: "inline-flex" }}>
          <Icon name="chevron" size={16} strokeWidth={2} />
        </span>
        Admin
      </Link>

      {rows.length === 0 ? (
        <EmptyState
          title="Nothing waiting"
          detail="New claims land here. Nobody sees the directory until you confirm they live here."
        />
      ) : (
        <>
          <p
            style={{
              fontSize: "var(--fp-text-base)",
              color: "var(--fp-ink-2)",
              maxWidth: "52ch",
              marginBottom: "var(--fp-space-5)",
            }}
          >
            {rows.length} {rows.length === 1 ? "person is" : "people are"} waiting to be
            confirmed. Approving one opens every neighbour&rsquo;s contact card to them,
            so check the address against your records first.
          </p>
          <div style={{ display: "grid", gap: "var(--fp-space-3)" }}>
            {rows.map((r) => (
              <ClaimCard key={r.request_id} row={r} communityId={membership.community_id} />
            ))}
          </div>
        </>
      )}
    </TabScreen>
  );
}
