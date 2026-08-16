import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { CATEGORY_ICONS } from "@/components/ui/ServiceTag";
import { cn } from "@/lib/utils";

/**
 * FrontPorch/ServiceCard — a category row on the Services screen.
 *
 * The subtitle counts neighbours, not listings, because that is what a
 * resident is actually asking: "how many people near me do this?"
 */
export function ServiceCard({
  label,
  icon = "paw",
  accent = "forest",
  neighbourCount,
  note,
  href,
  className,
}: {
  label: string;
  icon?: string;
  accent?: "forest" | "clay";
  neighbourCount: number;
  note?: string;
  href?: string;
  className?: string;
}) {
  const isClay = accent === "clay";

  const subtitle =
    neighbourCount === 0
      ? "No one offers this yet"
      : `${neighbourCount} ${neighbourCount === 1 ? "neighbour" : "neighbours"} offer this${note ? ` · ${note}` : ""}`;

  const inner = (
    <>
      <span
        className="inline-flex shrink-0 items-center justify-center rounded-full"
        style={{
          width: 44,
          height: 44,
          background: isClay ? "var(--fp-clay-wash)" : "var(--fp-forest-wash)",
          color: isClay ? "var(--fp-clay)" : "var(--fp-forest)",
        }}
      >
        <Icon name={CATEGORY_ICONS[icon] ?? "paw"} size={21} />
      </span>
      <span className="min-w-0 flex-1">
        <span
          className="block truncate"
          style={{
            fontFamily: "var(--fp-font-display)",
            fontSize: "var(--fp-text-md)",
            fontWeight: 600,
            color: "var(--fp-ink)",
          }}
        >
          {label}
        </span>
        <span
          className="block truncate"
          style={{ fontSize: "var(--fp-text-sm)", color: "var(--fp-ink-3)" }}
        >
          {subtitle}
        </span>
      </span>
      <Icon name="chevron" size={18} className="shrink-0" strokeWidth={1.8} />
    </>
  );

  const classes = cn("fp-card flex items-center gap-3.5 px-4 py-3.5 fp-tap", className);

  if (!href) return <div className={classes}>{inner}</div>;

  return (
    <Link href={href} className={classes} style={{ color: "var(--fp-ink-3)" }}>
      {inner}
    </Link>
  );
}
