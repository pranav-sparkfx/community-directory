"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * FrontPorch/BottomSheet — State = Peek | Half | Limited
 *
 * `Limited` is the state worth explaining, because it carries policy rather
 * than layout: it is what a household shows when its residents have narrowed
 * what they share. The design anticipating that state is the privacy model
 * surfacing in the UI, so it renders as a deliberate, explained surface — not
 * as a half-empty version of the full card.
 *
 * Dragging animates `transform` only, so it stays on the compositor. Under
 * prefers-reduced-motion the snap is instant rather than eased.
 */

export type SheetState = "peek" | "half" | "full";

export function BottomSheet({
  state,
  onStateChange,
  peekContent,
  children,
  ariaLabel,
}: {
  state: SheetState;
  onStateChange: (s: SheetState) => void;
  peekContent?: React.ReactNode;
  children?: React.ReactNode;
  ariaLabel: string;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const startY = useRef(0);
  const startState = useRef<SheetState>(state);

  const heightFor = (s: SheetState) =>
    s === "peek"
      ? "var(--fp-sheet-peek)"
      : s === "half"
        ? "var(--fp-sheet-half)"
        : "var(--fp-sheet-full)";

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      startY.current = e.clientY;
      startState.current = state;
      setDrag(0);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [state],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (drag === null) return;
      setDrag(e.clientY - startY.current);
    },
    [drag],
  );

  const onPointerUp = useCallback(() => {
    if (drag === null) return;
    const dy = drag;
    setDrag(null);

    // A short flick counts as intent; a long drag is measured against the
    // 60px threshold so a stray tap never changes state.
    const THRESHOLD = 60;
    const order: SheetState[] = ["peek", "half", "full"];
    const i = order.indexOf(startState.current);

    if (dy < -THRESHOLD) onStateChange(order[Math.min(i + 1, 2)]!);
    else if (dy > THRESHOLD) onStateChange(order[Math.max(i - 1, 0)]!);
  }, [drag, onStateChange]);

  // Escape collapses the sheet — a keyboard user must be able to get back to
  // the map without hunting for a close control.
  useEffect(() => {
    if (state === "peek") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onStateChange("peek");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state, onStateChange]);

  return (
    <section
      ref={sheetRef}
      aria-label={ariaLabel}
      className="fixed inset-x-0 z-20 flex flex-col"
      style={{
        bottom: `calc(var(--fp-tabbar-h) + env(safe-area-inset-bottom))`,
        height: heightFor(state),
        maxHeight: "var(--fp-sheet-full)",
        background: "var(--fp-surface)",
        borderTopLeftRadius: "var(--fp-radius-sheet)",
        borderTopRightRadius: "var(--fp-radius-sheet)",
        boxShadow: "var(--fp-shadow-sheet)",
        transform: drag === null ? "translateY(0)" : `translateY(${Math.max(0, drag)}px)`,
        transition: drag === null ? `height var(--fp-dur-sheet) var(--fp-ease-out)` : "none",
        touchAction: "none",
      }}
    >
      {/* Grab handle — also the keyboard control for the sheet. */}
      <button
        type="button"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={() => onStateChange(state === "peek" ? "half" : state === "half" ? "full" : "peek")}
        aria-label={
          state === "peek" ? "Expand panel" : state === "half" ? "Expand panel fully" : "Collapse panel"
        }
        aria-expanded={state !== "peek"}
        className="flex w-full shrink-0 items-center justify-center"
        style={{ height: 28, cursor: "grab" }}
      >
        <span
          style={{
            width: 40,
            height: 4,
            borderRadius: 999,
            background: "var(--fp-line)",
            display: "block",
          }}
        />
      </button>

      {state === "peek" && peekContent ? (
        <div className="px-5 pb-2">{peekContent}</div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6">
          {children}
        </div>
      )}
    </section>
  );
}

/** The "Limited" surface: a household that has narrowed what it shares. */
export function LimitedNotice({ className }: { className?: string }) {
  return (
    <div
      className={cn("rounded-xl px-4 py-3.5", className)}
      style={{ background: "var(--fp-surface-sunk)" }}
    >
      <p style={{ fontSize: "var(--fp-text-base)", color: "var(--fp-ink-2)" }}>
        This household shares limited details with neighbours.
      </p>
      <p style={{ fontSize: "var(--fp-text-sm)", color: "var(--fp-ink-3)", marginTop: 4 }}>
        That is their choice, and you can set the same for your own home in
        Profile &rarr; Privacy.
      </p>
    </div>
  );
}
