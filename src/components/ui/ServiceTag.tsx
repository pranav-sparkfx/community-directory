import { cn } from "@/lib/utils";
import { Icon, type IconName } from "./Icon";

/**
 * FrontPorch/ServiceTag — the small pill on a household card showing what a
 * household offers ("Pet Care", "Babysitting", "Tutoring").
 *
 * Category accent comes from the database (service_categories.accent) rather
 * than being hardcoded per slug, so adding a category is a data change.
 */

export const CATEGORY_ICONS: Record<string, IconName> = {
  paw: "paw",
  child: "child",
  book: "book",
  hammer: "hammer",
  car: "car",
  monitor: "monitor",
};

export function ServiceTag({
  label,
  icon = "paw",
  accent = "forest",
  className,
}: {
  label: string;
  icon?: string;
  accent?: "forest" | "clay";
  className?: string;
}) {
  const isClay = accent === "clay";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1",
        className,
      )}
      style={{
        background: isClay ? "var(--fp-clay-wash)" : "var(--fp-forest-wash)",
        borderColor: isClay ? "var(--fp-clay-wash)" : "var(--fp-forest-wash)",
        color: isClay ? "var(--fp-clay)" : "var(--fp-forest)",
        fontSize: "var(--fp-text-sm)",
        fontWeight: 500,
      }}
    >
      <Icon name={CATEGORY_ICONS[icon] ?? "paw"} size={14} strokeWidth={1.8} />
      {label}
    </span>
  );
}
