"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { relativeDay } from "@/lib/utils";
import { resolveReport } from "./actions";

export type Report = {
  id: string;
  target_type: "service" | "announcement" | "event" | "profile" | "household";
  target_id: string;
  reason: string;
  detail: string | null;
  reporter: string;
  summary: string | null;
  also_reported_by: number;
  created_at: string;
};

const WHAT: Record<Report["target_type"], string> = {
  service: "Service listing",
  announcement: "Announcement",
  event: "Event",
  profile: "A neighbour",
  household: "A home",
};

/**
 * Reports.
 *
 * A report about a person is deliberately not resolvable here: removing
 * someone is a judgement about their membership and belongs on the members
 * screen where the rank rules apply. The database refuses it too — this just
 * makes the refusal visible instead of offering a button that would fail.
 */
export function ReportQueue({ initial }: { initial: Report[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [note, setNote] = useState("");

  function act(id: string, action: "dismiss" | "remove") {
    setError(null);
    startTransition(async () => {
      const r = await resolveReport(id, action, note);
      if (!r.ok) {
        setError(r.error ?? "That did not work.");
        return;
      }
      setOpen(null);
      setNote("");
      router.refresh();
    });
  }

  if (initial.length === 0) {
    return (
      <EmptyState
        title="Nothing reported"
        detail="When a neighbour flags a listing, a post or a profile, it lands here."
      />
    );
  }

  return (
    <>
      {error ? (
        <p
          role="alert"
          className="mb-4 rounded-xl px-4 py-3"
          style={{
            background: "var(--fp-rejected-wash)",
            color: "var(--fp-rejected)",
            fontSize: "var(--fp-text-base)",
          }}
        >
          {error}
        </p>
      ) : null}

      <div style={{ display: "grid", gap: "var(--fp-space-3)" }}>
        {initial.map((r) => {
          const aboutAPerson = r.target_type === "profile" || r.target_type === "household";
          return (
            <article key={r.id} className="fp-card px-4 py-4">
              <div className="flex items-start justify-between gap-3">
                <span
                  className="rounded-full px-2.5 py-0.5"
                  style={{
                    background: "var(--fp-clay-wash)",
                    color: "var(--fp-clay)",
                    fontSize: "var(--fp-text-xs)",
                    fontWeight: 600,
                  }}
                >
                  {WHAT[r.target_type]}
                </span>
                <span style={{ fontSize: "var(--fp-text-xs)", color: "var(--fp-ink-3)" }}>
                  {relativeDay(r.created_at)}
                </span>
              </div>

              <h3
                style={{
                  fontFamily: "var(--fp-font-display)",
                  fontSize: "var(--fp-text-lg)",
                  marginTop: "var(--fp-space-2)",
                }}
              >
                {r.summary ?? "That content is already gone"}
              </h3>

              <p
                className="mt-3 rounded-xl px-3.5 py-2.5"
                style={{
                  background: "var(--fp-surface-sunk)",
                  fontSize: "var(--fp-text-base)",
                  color: "var(--fp-ink-2)",
                }}
              >
                <strong style={{ fontWeight: 600 }}>{r.reason}</strong>
                {r.detail ? ` — ${r.detail}` : ""}
              </p>

              <p style={{ fontSize: "var(--fp-text-sm)", color: "var(--fp-ink-3)", marginTop: 8 }}>
                Reported by {r.reporter}
                {r.also_reported_by > 0
                  ? ` and ${r.also_reported_by} other${r.also_reported_by === 1 ? "" : "s"}`
                  : ""}
              </p>

              {open === r.id ? (
                <div className="mt-4">
                  <label className="block">
                    <span className="fp-eyebrow">
                      What to tell {r.also_reported_by > 0 ? "everyone who reported it" : r.reporter}
                    </span>
                    <input
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Thanks — we have taken it down."
                      className="mt-1.5 w-full rounded-xl px-3.5"
                      style={{
                        minHeight: 44,
                        border: "1px solid var(--fp-line)",
                        background: "var(--fp-surface)",
                        fontSize: "var(--fp-text-base)",
                      }}
                    />
                  </label>
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => setOpen(null)}
                      className="fp-tap flex-1 rounded-xl"
                      style={{
                        border: "1px solid var(--fp-line)",
                        fontSize: "var(--fp-text-base)",
                        fontWeight: 500,
                      }}
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => act(r.id, "remove")}
                      className="fp-tap flex-1 rounded-xl"
                      style={{
                        background: "var(--fp-rejected)",
                        color: "var(--fp-ink-inverse)",
                        fontSize: "var(--fp-text-base)",
                        fontWeight: 600,
                        opacity: pending ? 0.6 : 1,
                      }}
                    >
                      Take it down
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-4 flex gap-2">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => act(r.id, "dismiss")}
                    className="fp-tap flex-1 rounded-xl"
                    style={{
                      border: "1px solid var(--fp-line)",
                      fontSize: "var(--fp-text-base)",
                      fontWeight: 500,
                    }}
                  >
                    Leave it up
                  </button>
                  {aboutAPerson ? (
                    <Link
                      href="/admin/members"
                      className="fp-tap flex flex-1 items-center justify-center rounded-xl"
                      style={{
                        border: "1px solid var(--fp-line)",
                        fontSize: "var(--fp-text-base)",
                        fontWeight: 500,
                      }}
                    >
                      Open members
                    </Link>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(r.id);
                        setNote("");
                      }}
                      className="fp-tap flex-1 rounded-xl"
                      style={{
                        border: "1px solid var(--fp-rejected)",
                        color: "var(--fp-rejected)",
                        fontSize: "var(--fp-text-base)",
                        fontWeight: 500,
                      }}
                    >
                      Take it down
                    </button>
                  )}
                </div>
              )}

              {aboutAPerson ? (
                <p
                  style={{
                    fontSize: "var(--fp-text-sm)",
                    color: "var(--fp-ink-3)",
                    marginTop: 10,
                  }}
                >
                  Removing a person is not done from here — their role and membership live
                  on the members screen, where the rank rules apply.
                </p>
              ) : null}
            </article>
          );
        })}
      </div>
    </>
  );
}
