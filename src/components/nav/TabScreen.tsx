import { SectionHeader } from "@/components/ui/Controls";
import { NotificationBell } from "@/components/nav/NotificationBell";
import { TabBar } from "@/components/nav/TabBar";

/**
 * Shared shell for the non-map tabs.
 *
 * The map owns the whole viewport and positions itself; these screens are
 * ordinary scrolling documents. Bottom padding clears the tab bar and the
 * home indicator so the last card is never trapped underneath them.
 */
export function TabScreen({
  eyebrow,
  title,
  action,
  showAdmin = false,
  children,
}: {
  eyebrow?: string;
  title: string;
  action?: React.ReactNode;
  showAdmin?: boolean;
  children: React.ReactNode;
}) {
  return (
    <>
      <main
        className="mx-auto w-full max-w-2xl px-5"
        style={{
          paddingTop: `calc(env(safe-area-inset-top) + var(--fp-space-6))`,
          paddingBottom: `calc(var(--fp-tabbar-h) + env(safe-area-inset-bottom) + var(--fp-space-8))`,
        }}
      >
        <SectionHeader
          eyebrow={eyebrow}
          title={title}
          // The bell is always present and always last, so its position is
          // learnable; a page's own action sits to its left rather than
          // displacing it.
          action={
            <div className="flex items-center gap-1">
              {action}
              <NotificationBell />
            </div>
          }
        />
        <div style={{ marginTop: "var(--fp-space-6)" }}>{children}</div>
      </main>
      <TabBar showAdmin={showAdmin} />
    </>
  );
}
