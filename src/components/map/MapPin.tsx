/**
 * FrontPorch/MapPin — Kind = Default | Selected | Service | Unlisted | Cluster
 *
 * A note on `Unlisted`, because it is the one that carries policy weight:
 * it is NOT used for a household that opted off the map. Those households
 * emit no marker at all — a grey pin at a real address still discloses that
 * someone lives there. `Unlisted` is only for a household a resident has
 * explicitly chosen to show as present-but-private.
 */

export type PinKind = "default" | "selected" | "service" | "unlisted" | "cluster";

export function MapPin({
  kind = "default",
  count,
  size,
}: {
  kind?: PinKind;
  count?: number;
  size?: number;
}) {
  if (kind === "cluster") {
    const d = size ?? 44;
    return (
      <span
        className="inline-flex items-center justify-center rounded-full"
        style={{
          width: d,
          height: d,
          background: "var(--fp-forest)",
          color: "var(--fp-ink-inverse)",
          border: "2.5px solid var(--fp-surface)",
          boxShadow: "var(--fp-shadow-pin)",
          fontSize: d * 0.34,
          fontWeight: 600,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {count ?? 0}
      </span>
    );
  }

  const selected = kind === "selected";
  const w = size ?? (selected ? 38 : 30);
  const h = w * 1.2;

  const fill =
    kind === "service"
      ? "var(--fp-clay)"
      : kind === "unlisted"
        ? "var(--fp-ink-3)"
        : "var(--fp-forest)";

  return (
    <svg
      width={w}
      height={h}
      viewBox="0 0 30 36"
      fill="none"
      aria-hidden="true"
      style={{ filter: "drop-shadow(0 2px 3px rgb(26 26 24 / 0.28))" }}
    >
      {/* Teardrop body */}
      <path
        d="M15 0C6.7 0 0 6.7 0 15c0 9.8 12.3 19.6 13.6 20.6a2.2 2.2 0 0 0 2.8 0C17.7 34.6 30 24.8 30 15 30 6.7 23.3 0 15 0Z"
        fill={fill}
        stroke="var(--fp-surface)"
        strokeWidth={selected ? 2.4 : 1.6}
      />
      {kind === "unlisted" ? (
        /* A dot rather than a house: present, but not disclosing a household */
        <circle cx="15" cy="14.5" r="3.2" fill="var(--fp-surface)" />
      ) : (
        /* House glyph, matching the Figma pin interior */
        <path
          d="M9 15.2 15 10l6 5.2M10.8 14.2v6h8.4v-6"
          stroke="var(--fp-surface)"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

/** FrontPorch/PinCallout — the dark address chip above a selected pin. */
export function PinCallout({ label }: { label: string }) {
  return (
    <span
      className="inline-flex items-center rounded-lg px-2.5 py-1.5 whitespace-nowrap"
      style={{
        background: "var(--fp-ink)",
        color: "var(--fp-ink-inverse)",
        fontSize: "var(--fp-text-sm)",
        fontWeight: 500,
        boxShadow: "var(--fp-shadow-raised)",
      }}
    >
      {label}
    </span>
  );
}
