/**
 * Consistent empty state — never a bare "No results".
 *
 * Lives here rather than beside TabScreen because client components need it
 * too, and TabScreen imports the notification bell, which reads cookies. One
 * client import of `EmptyState` from there was enough to drag `next/headers`
 * into the browser bundle and fail the build.
 */
export function EmptyState({ title, detail }: { title: string; detail?: string }) {
  return (
    <div
      className="rounded-2xl px-5 py-8 text-center"
      style={{ background: "var(--fp-surface-sunk)" }}
    >
      <p style={{ fontFamily: "var(--fp-font-display)", fontSize: "var(--fp-text-lg)" }}>
        {title}
      </p>
      {detail ? (
        <p
          style={{
            fontSize: "var(--fp-text-base)",
            color: "var(--fp-ink-3)",
            marginTop: 6,
            maxWidth: "42ch",
            marginInline: "auto",
          }}
        >
          {detail}
        </p>
      ) : null}
    </div>
  );
}
