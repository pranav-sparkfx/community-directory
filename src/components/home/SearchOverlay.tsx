"use client";

import { useEffect, useRef } from "react";
import { Icon } from "@/components/ui/Icon";
import type { SearchResult } from "@/lib/types";

/**
 * The suggestion panel under the search bar.
 *
 * Two labelled groups over one flat array. The split matters to a reader —
 * "am I looking at a person or a door" is the first thing to know — but the
 * keyboard has to walk a single sequence, so `results` arrives already
 * ordered (people, then homes) and this component only decides where to draw
 * the headings. Nothing here re-sorts or re-filters; getting the two views
 * out of step is exactly how ↓↓↓Enter opens the wrong household.
 *
 * ARIA 1.2 combobox: the input keeps `role="combobox"` and lives in
 * SearchField, this is its listbox, and they are tied together by id. The
 * active row is tracked with `aria-activedescendant` rather than real focus,
 * so the caret never leaves the input and typing stays uninterrupted.
 */
export function SearchOverlay({
  results,
  query,
  activeIndex,
  listboxId,
  optionId,
  onPick,
  onHover,
}: {
  results: SearchResult[];
  query: string;
  activeIndex: number;
  listboxId: string;
  optionId: (index: number) => string;
  onPick: (result: SearchResult) => void;
  onHover: (index: number) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  // Keep the keyboard-active row on screen. Without this, ↓ past the fold
  // moves a highlight the user cannot see and Enter opens a household they
  // never looked at.
  useEffect(() => {
    if (activeIndex < 0) return;
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-index="${activeIndex}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const people = results.filter((r) => r.kind === "person");
  const homes = results.filter((r) => r.kind === "household");

  const panelStyle = {
    background: "var(--fp-surface)",
    border: "1px solid var(--fp-line)",
    borderRadius: "var(--fp-radius-lg)",
    boxShadow: "var(--fp-shadow-raised)",
  } as const;

  if (results.length === 0) {
    return (
      <div
        className="absolute inset-x-0 top-full z-30 mt-2 px-4 py-4"
        style={panelStyle}
        role="status"
      >
        <p style={{ fontSize: "var(--fp-text-base)", color: "var(--fp-ink-2)" }}>
          Nothing matches “{query}”.
        </p>
        <p
          style={{
            fontSize: "var(--fp-text-sm)",
            color: "var(--fp-ink-3)",
            marginTop: 4,
          }}
        >
          Try a neighbour’s first name, a surname, or a street.
        </p>
      </div>
    );
  }

  return (
    <div
      ref={listRef}
      id={listboxId}
      role="listbox"
      aria-label="Search results"
      className="absolute inset-x-0 top-full z-30 mt-2 overflow-y-auto overscroll-contain py-1.5"
      style={{ ...panelStyle, maxHeight: "55svh" }}
      // Keeps the caret in the input: a pointer-down on the panel would
      // otherwise blur the field mid-tap, and on iOS the keyboard collapsing
      // moves the row out from under the finger before the click lands.
      onMouseDown={(e) => e.preventDefault()}
    >
      {people.length > 0 ? (
        <Group label="People">
          {people.map((r) => {
            const index = results.indexOf(r);
            return (
              <Row
                key={r.id}
                index={index}
                active={index === activeIndex}
                id={optionId(index)}
                icon="people"
                title={r.kind === "person" ? r.person.name : ""}
                subtitle={
                  r.kind === "person"
                    ? [r.person.address, r.person.unit].filter(Boolean).join(", ")
                    : ""
                }
                onPick={() => onPick(r)}
                onHover={() => onHover(index)}
              />
            );
          })}
        </Group>
      ) : null}

      {homes.length > 0 ? (
        <Group label="Addresses">
          {homes.map((r) => {
            const index = results.indexOf(r);
            const p = r.feature.properties;
            const meta = [
              p.resident_count > 0 ? `${p.resident_count} listed` : "No listed residents",
              p.kind === "service" ? "Offers a service" : null,
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <Row
                key={r.id}
                index={index}
                active={index === activeIndex}
                id={optionId(index)}
                icon="home"
                title={[p.address, p.unit].filter(Boolean).join(", ")}
                subtitle={meta}
                onPick={() => onPick(r)}
                onHover={() => onHover(index)}
              />
            );
          })}
        </Group>
      ) : null}
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="group" aria-label={label}>
      <p className="fp-eyebrow" style={{ padding: "8px 16px 4px" }}>
        {label}
      </p>
      {children}
    </div>
  );
}

function Row({
  index,
  id,
  active,
  icon,
  title,
  subtitle,
  onPick,
  onHover,
}: {
  index: number;
  id: string;
  active: boolean;
  icon: "people" | "home";
  title: string;
  subtitle: string;
  onPick: () => void;
  onHover: () => void;
}) {
  return (
    <div
      id={id}
      role="option"
      data-index={index}
      aria-selected={active}
      onClick={onPick}
      onMouseEnter={onHover}
      className="flex w-full cursor-pointer items-center gap-3 px-4 py-2.5"
      style={{ background: active ? "var(--fp-surface-sunk)" : "transparent" }}
    >
      <span
        className="flex shrink-0 items-center justify-center rounded-full"
        style={{
          width: 32,
          height: 32,
          background: "var(--fp-surface-sunk)",
          color: "var(--fp-ink-2)",
        }}
      >
        <Icon name={icon} size={16} strokeWidth={1.8} />
      </span>
      <span className="min-w-0 flex-1">
        <span
          className="block truncate"
          style={{
            fontSize: "var(--fp-text-base)",
            fontWeight: 600,
            color: "var(--fp-ink)",
          }}
        >
          {title}
        </span>
        {subtitle ? (
          <span
            className="block truncate"
            style={{ fontSize: "var(--fp-text-sm)", color: "var(--fp-ink-3)" }}
          >
            {subtitle}
          </span>
        ) : null}
      </span>
    </div>
  );
}
