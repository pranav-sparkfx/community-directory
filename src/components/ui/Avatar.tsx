import { cn, initials } from "@/lib/utils";

/**
 * FrontPorch/AvatarMonogram — 44px initials disc.
 *
 * No photo variant yet: resident photos live in a private Storage bucket
 * and need signed URLs, which arrives with the household editor in Phase 3.
 * The monogram is the honest default until then.
 *
 * Tint is derived from the name so a person keeps the same colour everywhere,
 * rather than being random per render.
 */

const TINTS = [
  { bg: "var(--fp-forest-wash)", fg: "var(--fp-forest)" },
  { bg: "var(--fp-clay-wash)", fg: "var(--fp-clay)" },
  { bg: "var(--fp-surface-sunk)", fg: "var(--fp-ink-2)" },
] as const;

function tintFor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return TINTS[Math.abs(hash) % TINTS.length]!;
}

export function AvatarMonogram({
  name,
  size = 44,
  className,
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  const tint = tintFor(name);
  return (
    <span
      className={cn("inline-flex items-center justify-center rounded-full select-none", className)}
      style={{
        width: size,
        height: size,
        background: tint.bg,
        color: tint.fg,
        fontSize: size * 0.34,
        fontWeight: 600,
        letterSpacing: "0.02em",
      }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}

/**
 * FrontPorch/AvatarPair — two overlapping monograms for a two-adult household.
 * Overlap is what signals "one household, two people" rather than two rows.
 */
export function AvatarPair({
  names,
  size = 44,
  className,
}: {
  names: string[];
  size?: number;
  className?: string;
}) {
  const shown = names.slice(0, 2);
  if (shown.length <= 1) {
    return <AvatarMonogram name={shown[0] ?? "?"} size={size} className={className} />;
  }
  return (
    <span className={cn("inline-flex items-center", className)} aria-hidden="true">
      {shown.map((n, i) => (
        <span
          key={n + i}
          style={{
            marginLeft: i === 0 ? 0 : -size * 0.28,
            // Ring in the page ground so the discs read as separate objects
            // where they overlap, without a shadow.
            boxShadow: `0 0 0 2px var(--fp-surface)`,
            borderRadius: "999px",
            display: "inline-flex",
            position: "relative",
            // Earlier avatars sit ON TOP, so the overlap eats the trailing
            // disc's edge rather than covering the leading one's initials.
            zIndex: shown.length - i,
          }}
        >
          <AvatarMonogram name={n} size={size} />
        </span>
      ))}
    </span>
  );
}
