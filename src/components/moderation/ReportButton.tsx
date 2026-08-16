"use client";

import { useState, useTransition } from "react";
import { Icon } from "@/components/ui/Icon";
import { reportContent } from "@/app/services/report-action";

const REASONS = [
  "Spam or an advert",
  "Not a real neighbour",
  "Offensive or abusive",
  "Wrong or out of date",
  "Something else",
];

/**
 * Report something.
 *
 * Deliberately quiet: a small text control rather than a button, opened into
 * a short list of reasons. Reporting a neighbour is a serious act in a place
 * where everyone knows each other, and a prominent red button invites use as
 * a disagreement tool.
 *
 * Filing twice is idempotent at the database level, so the confirmation is
 * honest even on a double tap — it never says "reported" twice for one thing.
 */
export function ReportButton({
  targetType,
  targetId,
  label = "Report this",
}: {
  targetType: "service" | "announcement" | "event" | "profile" | "household";
  targetId: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState(REASONS[0]!);
  const [detail, setDetail] = useState("");
  const [pending, startTransition] = useTransition();

  if (done) {
    return (
      <p
        role="status"
        style={{ fontSize: "var(--fp-text-sm)", color: "var(--fp-verified)" }}
      >
        Reported. A moderator will look at it.
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5"
        style={{
          fontSize: "var(--fp-text-sm)",
          color: "var(--fp-ink-3)",
          minHeight: 32,
        }}
      >
        <Icon name="filter" size={14} strokeWidth={1.8} />
        {label}
      </button>
    );
  }

  return (
    <div
      className="mt-2 rounded-xl px-3.5 py-3"
      style={{ background: "var(--fp-surface-sunk)" }}
    >
      {error ? (
        <p
          role="alert"
          style={{ fontSize: "var(--fp-text-sm)", color: "var(--fp-rejected)", marginBottom: 8 }}
        >
          {error}
        </p>
      ) : null}

      <fieldset>
        <legend className="fp-eyebrow">What is wrong with it</legend>
        <div className="mt-2" style={{ display: "grid", gap: 2 }}>
          {REASONS.map((r) => (
            <label key={r} className="flex items-center gap-2.5 py-1.5">
              <input
                type="radio"
                name={`reason-${targetId}`}
                checked={reason === r}
                onChange={() => setReason(r)}
                style={{ width: 18, height: 18, accentColor: "var(--fp-forest)" }}
              />
              <span style={{ fontSize: "var(--fp-text-base)" }}>{r}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <input
        value={detail}
        onChange={(e) => setDetail(e.target.value)}
        placeholder="Anything else the moderator should know (optional)"
        aria-label="More detail"
        className="mt-2 w-full rounded-lg px-3"
        style={{
          minHeight: 40,
          border: "1px solid var(--fp-line)",
          background: "var(--fp-surface)",
          fontSize: "var(--fp-text-sm)",
        }}
      />

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="flex-1 rounded-lg"
          style={{
            minHeight: 38,
            border: "1px solid var(--fp-line)",
            fontSize: "var(--fp-text-sm)",
            fontWeight: 500,
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const r = await reportContent(targetType, targetId, reason, detail);
              if (!r.ok) {
                setError(r.error ?? "That did not send.");
                return;
              }
              setDone(true);
            });
          }}
          className="flex-1 rounded-lg"
          style={{
            minHeight: 38,
            background: "var(--fp-clay)",
            color: "var(--fp-ink-inverse)",
            fontSize: "var(--fp-text-sm)",
            fontWeight: 600,
            opacity: pending ? 0.6 : 1,
          }}
        >
          {pending ? "Sending…" : "Send report"}
        </button>
      </div>
    </div>
  );
}
