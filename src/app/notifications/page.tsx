import { redirect } from "next/navigation";
import { TabScreen } from "@/components/nav/TabScreen";
import { EmptyState } from "@/components/ui/EmptyState";
import { createClient, getViewer } from "@/lib/supabase/server";
import { NotificationList, type Note } from "./NotificationList";
import { PushToggle } from "./PushToggle";

export const dynamic = "force-dynamic";

/**
 * The inbox.
 *
 * Not scoped to the active community: an alert about a claim you filed
 * somewhere else still matters, and hiding it behind the switcher is how a
 * resident misses the one message they were waiting for.
 */
export default async function NotificationsPage() {
  const supabase = await createClient();
  const { user, isStaff } = await getViewer();
  if (!user) redirect("/sign-in");

  const { data } = await supabase.rpc("notification_feed", { limit_n: 60 });
  const notes = (data ?? []) as Note[];

  return (
    <TabScreen eyebrow="Front Porch" title="Notifications" showAdmin={isStaff}>
      {/* The key is public by design — it identifies this deployment to the
          browser's push service. The private half never leaves the server. */}
      <PushToggle vapidPublicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ""} />

      {notes.length === 0 ? (
        <EmptyState
          title="Nothing yet"
          detail="Announcements, alerts and anything an admin decides about you will land here."
        />
      ) : (
        <NotificationList notes={notes} />
      )}
    </TabScreen>
  );
}
