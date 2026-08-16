"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/ui/Icon";

/**
 * FrontPorch/TabBar — Home | Services | Announcements | Admin
 *
 * The Admin tab is rendered only for moderators and above; `showAdmin` is
 * resolved server-side from the caller's membership role rather than guessed
 * on the client, so a resident never sees a tab that would refuse them.
 */

const TABS: { href: string; label: string; icon: IconName }[] = [
  { href: "/", label: "Home", icon: "home" },
  { href: "/services", label: "Services", icon: "services" },
  { href: "/announcements", label: "News", icon: "announcements" },
  { href: "/you", label: "You", icon: "people" },
];

const ADMIN_TAB = { href: "/admin", label: "Admin", icon: "admin" as IconName };

export function TabBar({ showAdmin = false }: { showAdmin?: boolean }) {
  const pathname = usePathname();
  const tabs = showAdmin ? [...TABS, ADMIN_TAB] : TABS;

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 flex items-stretch"
      style={{
        height: `calc(var(--fp-tabbar-h) + env(safe-area-inset-bottom))`,
        paddingBottom: "env(safe-area-inset-bottom)",
        background: "var(--fp-surface)",
        borderTop: "1px solid var(--fp-line)",
      }}
    >
      {tabs.map((tab) => {
        const active =
          tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className="flex flex-1 flex-col items-center justify-center gap-1"
            style={{
              color: active ? "var(--fp-forest)" : "var(--fp-ink-3)",
              fontWeight: active ? 600 : 400,
            }}
          >
            <Icon name={tab.icon} size={22} strokeWidth={active ? 1.9 : 1.6} />
            <span style={{ fontSize: "var(--fp-text-xs)" }}>{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
