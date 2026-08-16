import Link from "next/link";
import { AvatarPair } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icon";
import { cn, householdTitle } from "@/lib/utils";

/**
 * FrontPorch/ResidentRow — a household in a list (search results, directory,
 * admin tables). The map's counterpart to a pin.
 *
 * `names` arrives already filtered by the database: household_card() and the
 * RLS policies drop unlisted members and residents who opted out of the
 * directory before this component ever sees them. Nothing here filters, and
 * nothing here should — a component that decides visibility is a component
 * that can get it wrong.
 */
export function ResidentRow({
  address,
  names,
  meta,
  href,
  className,
}: {
  address: string;
  names: string[];
  meta?: string;
  href?: string;
  className?: string;
}) {
  const inner = (
    <>
      <AvatarPair names={names} size={44} />
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
          {householdTitle(names)}
        </span>
        <span
          className="block truncate"
          style={{ fontSize: "var(--fp-text-sm)", color: "var(--fp-ink-3)" }}
        >
          {address}
          {meta ? ` · ${meta}` : ""}
        </span>
      </span>
      <Icon name="chevron" size={18} className="shrink-0" strokeWidth={1.8} />
    </>
  );

  const classes = cn(
    "flex w-full items-center gap-3.5 px-4 py-3 text-left fp-tap",
    className,
  );

  if (!href) return <div className={classes}>{inner}</div>;

  return (
    <Link href={href} className={classes} style={{ color: "var(--fp-ink-3)" }}>
      {inner}
    </Link>
  );
}
