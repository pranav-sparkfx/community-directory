import Link from "next/link";
import { cn, shortDate } from "@/lib/utils";

/**
 * FrontPorch/AnnouncementCard
 *
 * `kind` distinguishes an official HOA notice from a neighbour's post. That
 * distinction is the whole point of the badge: a resident must be able to
 * tell "the board says the pool opens Monday" from "a neighbour lost a cat"
 * at a glance, so the two get different accents rather than the same chip.
 */
export function AnnouncementCard({
  kind,
  title,
  body,
  publishedAt,
  href,
  pinned = false,
  className,
}: {
  kind: "hoa" | "neighbor";
  title: string;
  body: string;
  publishedAt: string | Date;
  href?: string;
  pinned?: boolean;
  className?: string;
}) {
  const isHoa = kind === "hoa";

  const inner = (
    <>
      <div className="flex items-center gap-2.5">
        <span
          className="inline-flex items-center rounded px-2 py-0.5"
          style={{
            background: isHoa ? "var(--fp-forest-wash)" : "var(--fp-clay-wash)",
            color: isHoa ? "var(--fp-forest)" : "var(--fp-clay)",
            fontSize: "var(--fp-text-xs)",
            fontWeight: 700,
            letterSpacing: "var(--fp-tracking-eyebrow)",
            textTransform: "uppercase",
          }}
        >
          {isHoa ? "HOA Board" : "Neighbour"}
        </span>
        <span style={{ fontSize: "var(--fp-text-sm)", color: "var(--fp-ink-3)" }}>
          {shortDate(publishedAt)}
        </span>
        {pinned ? (
          <span
            className="ml-auto"
            style={{ fontSize: "var(--fp-text-xs)", color: "var(--fp-ink-3)" }}
          >
            Pinned
          </span>
        ) : null}
      </div>

      <h2
        style={{
          fontSize: "var(--fp-text-lg)",
          marginTop: "var(--fp-space-3)",
          color: "var(--fp-ink)",
        }}
      >
        {title}
      </h2>

      <p
        style={{
          fontSize: "var(--fp-text-base)",
          color: "var(--fp-ink-2)",
          marginTop: "var(--fp-space-2)",
          lineHeight: "var(--fp-leading-normal)",
        }}
      >
        {body}
      </p>
    </>
  );

  const classes = cn("fp-card block px-4 py-4", className);

  if (!href) return <article className={classes}>{inner}</article>;

  return (
    <Link href={href} className={classes}>
      <article>{inner}</article>
    </Link>
  );
}
