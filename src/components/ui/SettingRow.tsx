"use client";

/**
 * FrontPorch/SettingRow — the privacy controls.
 *
 * Two shapes, one visual language: a switch for yes/no, a segmented control
 * for a scale. Both carry a description under the label, because every one of
 * these settings decides what a neighbour can see about someone's home, and a
 * bare label ("Phone") does not tell you that.
 *
 * Neither control has a Save button. A privacy setting that needs a second
 * confirming tap is a privacy setting people leave wrong.
 */

export function SwitchRow({
  label,
  detail,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  detail?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div
      className="flex items-start gap-4 py-4"
      style={{ borderBottom: "1px solid var(--fp-line)" }}
    >
      <div className="min-w-0 flex-1">
        <p style={{ fontSize: "var(--fp-text-base)", fontWeight: 500 }}>{label}</p>
        {detail ? (
          <p
            style={{
              fontSize: "var(--fp-text-sm)",
              color: "var(--fp-ink-3)",
              marginTop: 2,
              maxWidth: "44ch",
            }}
          >
            {detail}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className="relative shrink-0"
        // Deliberately NOT .fp-tap: that utility sets min-height 44px, which
        // would stretch the track into a blob. The 44px target is met by the
        // button box while the track stays a 50x30 pill drawn inside it.
        style={{ width: 50, height: 44, opacity: disabled ? 0.5 : 1 }}
      >
        <span
          className="absolute rounded-full transition-colors"
          style={{
            top: 7,
            left: 0,
            width: 50,
            height: 30,
            // Off is a mid ink, not a hairline: the track has to read as a
            // deliberate "no" against paper, not as a disabled control.
            background: checked ? "var(--fp-forest)" : "var(--fp-ink-3)",
            transitionDuration: "var(--fp-dur-fast)",
          }}
        />
        <span
          className="absolute rounded-full transition-transform"
          style={{
            top: 10,
            left: 3,
            width: 24,
            height: 24,
            background: "var(--fp-surface)",
            boxShadow: "var(--fp-shadow-raised)",
            transform: checked ? "translateX(20px)" : "translateX(0)",
            transitionDuration: "var(--fp-dur-fast)",
            transitionTimingFunction: "var(--fp-ease-out)",
          }}
        />
      </button>
    </div>
  );
}

export function SegmentedRow<T extends string>({
  label,
  detail,
  value,
  options,
  onChange,
}: {
  label: string;
  detail?: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (next: T) => void;
}) {
  return (
    <div className="py-4" style={{ borderBottom: "1px solid var(--fp-line)" }}>
      <p style={{ fontSize: "var(--fp-text-base)", fontWeight: 500 }}>{label}</p>
      {detail ? (
        <p
          style={{
            fontSize: "var(--fp-text-sm)",
            color: "var(--fp-ink-3)",
            marginTop: 2,
            maxWidth: "44ch",
          }}
        >
          {detail}
        </p>
      ) : null}
      <div
        role="radiogroup"
        aria-label={label}
        className="mt-3 flex gap-1 rounded-xl p-1"
        style={{ background: "var(--fp-surface-sunk)" }}
      >
        {options.map((o) => {
          const active = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(o.value)}
              className="flex-1 rounded-lg transition-colors"
              style={{
                minHeight: 38,
                background: active ? "var(--fp-surface)" : "transparent",
                color: active ? "var(--fp-ink)" : "var(--fp-ink-3)",
                fontSize: "var(--fp-text-sm)",
                fontWeight: active ? 600 : 500,
                boxShadow: active ? "var(--fp-shadow-raised)" : "none",
                transitionDuration: "var(--fp-dur-fast)",
              }}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Groups settings under a quiet heading, so the page scans as sections. */
export function SettingGroup({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-7">
      <h2
        style={{
          fontSize: "var(--fp-text-xs)",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--fp-ink-3)",
          fontWeight: 600,
        }}
      >
        {title}
      </h2>
      {note ? (
        <p
          style={{
            fontSize: "var(--fp-text-sm)",
            color: "var(--fp-ink-3)",
            marginTop: 4,
            maxWidth: "50ch",
          }}
        >
          {note}
        </p>
      ) : null}
      <div className="fp-card mt-3 px-4" style={{ paddingBottom: 0 }}>
        <div style={{ marginBottom: -1 }}>{children}</div>
      </div>
    </section>
  );
}
