import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { createClient } from "@/lib/supabase/server";

/**
 * The unread badge.
 *
 * Fetches its own count rather than taking it as a prop: it sits in the
 * header of every tab screen, and threading the number through a dozen page
 * components would mean a dozen chances to forget. The count comes from an
 * RPC scoped to auth.uid(), so it is one indexed query on the unread partial
 * index and nothing else can be asked for.
 *
 * Rendered as a count, not a dot, above zero — "3 waiting" and "17 waiting"
 * are different decisions about whether to look now.
 */
export async function NotificationBell() {
  const supabase = await createClient();
  const { data } = await supabase.rpc("unread_notification_count");
  const unread = typeof data === "number" ? data : 0;

  return (
    <Link
      href="/notifications"
      aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
      className="fp-tap relative inline-flex items-center justify-center rounded-full"
      style={{ width: 44, color: "var(--fp-ink-2)" }}
    >
      <Icon name="bell" size={22} strokeWidth={1.7} />
      {unread > 0 ? (
        <span
          aria-hidden="true"
          className="absolute inline-flex items-center justify-center rounded-full tabular-nums"
          style={{
            // Inside the 44px tap box, not hanging off it: a badge that
            // overflows gets clipped by the header's own bounds at the
            // right edge of a phone screen.
            top: 3,
            right: 3,
            minWidth: 18,
            height: 18,
            paddingInline: 5,
            background: "var(--fp-clay)",
            color: "var(--fp-ink-inverse)",
            fontSize: 11,
            fontWeight: 700,
            lineHeight: "18px",
            boxShadow: "0 0 0 2px var(--fp-surface)",
          }}
        >
          {unread > 99 ? "99+" : unread}
        </span>
      ) : null}
    </Link>
  );
}
