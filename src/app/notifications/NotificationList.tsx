"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Icon, type IconName } from "@/components/ui/Icon";
import { relativeDay } from "@/lib/utils";
import { markRead } from "./actions";

export type Note = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  community: string | null;
  read: boolean;
  created_at: string;
};

/**
 * What each kind of notification is about, so the icon carries meaning
 * rather than decorating. Anything unrecognised falls back to the megaphone
 * — a new notification kind should look plain, never break the row.
 */
const KIND: Record<string, { icon: IconName; tone: "forest" | "clay" }> = {
  announcement: { icon: "announcements", tone: "clay" },
  verification: { icon: "shield", tone: "forest" },
  neighbor: { icon: "people", tone: "forest" },
  listing: { icon: "services", tone: "forest" },
  report: { icon: "filter", tone: "clay" },
  role: { icon: "admin", tone: "forest" },
  membership: { icon: "people", tone: "clay" },
  community: { icon: "home", tone: "forest" },
};

export function NotificationList({ notes }: { notes: Note[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const unread = notes.filter((n) => !n.read).length;

  return (
    <>
      {unread > 0 ? (
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              await markRead();
              router.refresh();
            })
          }
          className="fp-tap mb-5 w-full rounded-xl"
          style={{
            border: "1px solid var(--fp-line)",
            fontSize: "var(--fp-text-base)",
            fontWeight: 500,
            opacity: pending ? 0.5 : 1,
          }}
        >
          {pending ? "Marking…" : `Mark all ${unread} as read`}
        </button>
      ) : null}

      <div style={{ display: "grid", gap: "var(--fp-space-2)" }}>
        {notes.map((n) => {
          const look = KIND[n.kind] ?? { icon: "announcements" as IconName, tone: "forest" as const };
          const body = (
            <>
              <span
                className="inline-flex shrink-0 items-center justify-center rounded-full"
                style={{
                  width: 38,
                  height: 38,
                  background:
                    look.tone === "clay" ? "var(--fp-clay-wash)" : "var(--fp-forest-wash)",
                  color: look.tone === "clay" ? "var(--fp-clay)" : "var(--fp-forest)",
                }}
              >
                <Icon name={look.icon} size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className="block"
                  style={{
                    fontSize: "var(--fp-text-base)",
                    // Unread is carried by weight, not by a coloured dot alone:
                    // it survives being read at a glance and in greyscale.
                    fontWeight: n.read ? 400 : 600,
                  }}
                >
                  {n.title}
                </span>
                {n.body ? (
                  <span
                    className="block"
                    style={{
                      fontSize: "var(--fp-text-sm)",
                      color: "var(--fp-ink-2)",
                      marginTop: 2,
                    }}
                  >
                    {n.body}
                  </span>
                ) : null}
                <span
                  className="block"
                  style={{
                    fontSize: "var(--fp-text-xs)",
                    color: "var(--fp-ink-3)",
                    marginTop: 4,
                  }}
                >
                  {n.community ? `${n.community} · ` : ""}
                  {relativeDay(n.created_at)}
                </span>
              </span>
              {!n.read ? (
                <span
                  aria-label="Unread"
                  className="mt-1.5 shrink-0 rounded-full"
                  style={{ width: 8, height: 8, background: "var(--fp-clay)" }}
                />
              ) : null}
            </>
          );

          return n.link ? (
            <Link
              key={n.id}
              href={n.link}
              onClick={() => {
                if (!n.read) startTransition(() => markRead([n.id]).then(() => {}));
              }}
              className="fp-card fp-tap flex items-start gap-3.5 px-4 py-3.5"
            >
              {body}
            </Link>
          ) : (
            <div key={n.id} className="fp-card flex items-start gap-3.5 px-4 py-3.5">
              {body}
            </div>
          );
        })}
      </div>
    </>
  );
}
