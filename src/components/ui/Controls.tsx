"use client";

import { cn } from "@/lib/utils";
import { Icon, type IconName } from "./Icon";

/**
 * FrontPorch/FilterChip — State=Default | Active
 * The map overlay chips ("Find Help", "New Residents · 2").
 */
export function FilterChip({
  label,
  icon,
  count,
  active = false,
  onClick,
  className,
}: {
  label: string;
  icon?: IconName;
  count?: number;
  active?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3.5 transition-[background-color,color,border-color]",
        className,
      )}
      style={{
        minHeight: 34,
        background: active ? "var(--fp-forest)" : "var(--fp-surface)",
        borderColor: active ? "var(--fp-forest)" : "var(--fp-line)",
        color: active ? "var(--fp-ink-inverse)" : "var(--fp-ink)",
        fontSize: "var(--fp-text-sm)",
        fontWeight: 500,
        boxShadow: "var(--fp-shadow-raised)",
        transitionDuration: "var(--fp-dur-fast)",
      }}
    >
      {icon ? <Icon name={icon} size={16} strokeWidth={1.8} /> : null}
      {label}
      {typeof count === "number" ? (
        <span style={{ opacity: 0.85 }}>· {count}</span>
      ) : null}
    </button>
  );
}

/**
 * FrontPorch/ActionButton — State=Enabled | Disabled
 *
 * The Call / Text / Directions / Email row on a household card. Disabled is a
 * first-class state here, not an afterthought: when a resident has hidden
 * their number, the control is present but inert with an explanation, so the
 * absence reads as a deliberate choice rather than a broken app.
 */
export function ActionButton({
  label,
  icon,
  href,
  disabled = false,
  disabledReason,
  className,
}: {
  label: string;
  icon: IconName;
  href?: string;
  disabled?: boolean;
  disabledReason?: string;
  className?: string;
}) {
  const body = (
    <>
      <span
        className="inline-flex items-center justify-center rounded-full"
        style={{
          width: 46,
          height: 46,
          background: disabled ? "var(--fp-surface-sunk)" : "var(--fp-forest)",
          color: disabled ? "var(--fp-ink-3)" : "var(--fp-ink-inverse)",
        }}
      >
        <Icon name={icon} size={20} />
      </span>
      <span
        style={{
          fontSize: "var(--fp-text-sm)",
          color: disabled ? "var(--fp-ink-3)" : "var(--fp-ink-2)",
        }}
      >
        {label}
      </span>
    </>
  );

  const shared = cn("flex flex-col items-center gap-1.5 fp-tap", className);

  if (disabled || !href) {
    return (
      <span className={shared} aria-disabled="true" title={disabledReason}>
        {body}
        {disabledReason ? <span className="fp-sr-only">{disabledReason}</span> : null}
      </span>
    );
  }

  return (
    <a href={href} className={shared}>
      {body}
    </a>
  );
}

/** FrontPorch/SectionHeader — clay eyebrow over a serif title. */
export function SectionHeader({
  eyebrow,
  title,
  action,
  className,
}: {
  eyebrow?: string;
  title: string;
  action?: React.ReactNode;
  className?: string;
}) {
  // Wraps rather than overflows. A flex item defaults to min-width:auto, so
  // the title block refused to shrink below its longest word and pushed the
  // action past the right edge — "Neighbourhood Services" next to a pill and
  // the bell measured 416px wide no matter how narrow the phone was, which is
  // why every tab scrolled sideways on a 320px screen.
  //
  // basis-48 is what decides when the action drops to its own line: the title
  // asks for 12rem before the row is allowed to wrap, so a wide screen keeps
  // the original single-line header and a phone gets two tidy lines instead of
  // a squeezed heading. ml-auto keeps the action right-aligned once wrapped,
  // which justify-between alone stops doing when an item is the only one on
  // its line.
  return (
    <header className={cn("flex flex-wrap items-end justify-between gap-x-4 gap-y-3", className)}>
      <div className="min-w-0 grow basis-48">
        {eyebrow ? <p className="fp-eyebrow">{eyebrow}</p> : null}
        <h1
          className="break-words"
          style={{ fontSize: "var(--fp-text-2xl)", marginTop: 4 }}
        >
          {title}
        </h1>
      </div>
      {action ? <div className="ml-auto shrink-0">{action}</div> : null}
    </header>
  );
}

/**
 * FrontPorch/SearchField — the rounded search bar over the map.
 *
 * Optionally the input half of an ARIA combobox. The listbox itself lives
 * outside this component (SearchOverlay renders it), which is what the 1.2
 * pattern wants: the input keeps `role="combobox"` and points at the list by
 * id, so the two can be positioned independently while the assistive-tech
 * relationship stays intact.
 *
 * `type="text"`, not `type="search"`. A native search input ships its own
 * clear affordance in WebKit — a second ✕ next to ours — and in several
 * browsers swallows Escape to clear itself, which would fight the overlay's
 * Escape-to-dismiss. Owning the control means owning both behaviours.
 */
export function SearchField({
  value,
  onChange,
  onFilterClick,
  onKeyDown,
  onFocus,
  onClear,
  inputRef,
  listboxId,
  isExpanded,
  activeOptionId,
  placeholder = "Search name or address",
  className,
}: {
  value?: string;
  onChange?: (v: string) => void;
  onFilterClick?: () => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onFocus?: () => void;
  onClear?: () => void;
  inputRef?: React.Ref<HTMLInputElement>;
  listboxId?: string;
  isExpanded?: boolean;
  activeOptionId?: string;
  placeholder?: string;
  className?: string;
}) {
  const isCombobox = typeof listboxId === "string";
  const hasValue = typeof value === "string" && value.length > 0;

  return (
    <div
      className={cn("flex items-center gap-2.5 rounded-full px-4", className)}
      style={{
        height: "var(--fp-searchfield-h)",
        background: "var(--fp-surface)",
        border: "1px solid var(--fp-line)",
        boxShadow: "var(--fp-shadow-raised)",
      }}
    >
      <Icon name="search" size={18} className="shrink-0" strokeWidth={1.8} />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        placeholder={placeholder}
        aria-label={placeholder}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        role={isCombobox ? "combobox" : undefined}
        aria-autocomplete={isCombobox ? "list" : undefined}
        aria-expanded={isCombobox ? Boolean(isExpanded) : undefined}
        aria-controls={isCombobox && isExpanded ? listboxId : undefined}
        aria-activedescendant={isCombobox ? activeOptionId : undefined}
        className="min-w-0 flex-1 bg-transparent outline-none"
        style={{ fontSize: "var(--fp-text-base)", color: "var(--fp-ink)" }}
      />
      {onClear && hasValue ? (
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear search"
          className="shrink-0"
          style={{ color: "var(--fp-ink-2)" }}
        >
          <Icon name="close" size={18} strokeWidth={1.8} />
        </button>
      ) : onFilterClick ? (
        <button
          type="button"
          onClick={onFilterClick}
          aria-label="Filters"
          className="shrink-0"
          style={{ color: "var(--fp-ink-2)" }}
        >
          <Icon name="filter" size={18} strokeWidth={1.8} />
        </button>
      ) : null}
    </div>
  );
}

/** Verification / moderation state. Semantic colour, never the brand accent. */
export function StatusPill({
  status,
  className,
}: {
  status: "verified" | "pending" | "rejected" | "unverified";
  className?: string;
}) {
  const map = {
    verified: { label: "Verified", bg: "var(--fp-verified-wash)", fg: "var(--fp-verified)" },
    pending: { label: "Awaiting review", bg: "var(--fp-pending-wash)", fg: "var(--fp-pending)" },
    rejected: { label: "Not approved", bg: "var(--fp-rejected-wash)", fg: "var(--fp-rejected)" },
    unverified: { label: "Unverified", bg: "var(--fp-surface-sunk)", fg: "var(--fp-ink-3)" },
  }[status];

  return (
    <span
      className={cn("inline-flex items-center rounded-full px-2.5 py-0.5", className)}
      style={{
        background: map.bg,
        color: map.fg,
        fontSize: "var(--fp-text-xs)",
        fontWeight: 600,
        letterSpacing: "0.02em",
      }}
    >
      {map.label}
    </span>
  );
}
