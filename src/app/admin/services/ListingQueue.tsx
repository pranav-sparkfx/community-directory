"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AvatarMonogram } from "@/components/ui/Avatar";
import { EmptyState } from "@/components/ui/EmptyState";
import { relativeDay } from "@/lib/utils";
import { decideService } from "./actions";

export type Pending = {
  id: string;
  title: string;
  description: string;
  category_label: string;
  availability: string | null;
  rate_note: string | null;
  author: string;
  address: string | null;
  created_at: string;
  prior_rejections: number;
};

/**
 * The listings queue.
 *
 * Everything a moderator needs to decide is on the card — the full text, who
 * wrote it, where they live, and whether this author has been turned down
 * here before. A queue that makes you open each item to judge it is a queue
 * that does not get cleared.
 */
export function ListingQueue({ initial }: { initial: Pending[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  function act(id: string, approve: boolean) {
    setError(null);
    startTransition(async () => {
      const r = await decideService(id, approve, approve ? "" : reason);
      if (!r.ok) {
        setError(r.error ?? "That did not work.");
        return;
      }
      setRejecting(null);
      setReason("");
      router.refresh();
    });
  }

  if (initial.length === 0) {
    return (
      <EmptyState
        title="Nothing waiting"
        detail="New service listings land here before neighbours can see them."
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
        {initial.map((s) => (
          <article key={s.id} className="fp-card px-4 py-4">
            <div className="flex items-start gap-3">
              <AvatarMonogram name={s.author} size={40} />
              <div className="min-w-0 flex-1">
                <p style={{ fontSize: "var(--fp-text-base)", fontWeight: 500 }}>{s.author}</p>
                <p style={{ fontSize: "var(--fp-text-sm)", color: "var(--fp-ink-3)" }}>
                  {s.address ?? "No address on file"} · {relativeDay(s.created_at)}
                </p>
              </div>
              <span
                className="shrink-0 rounded-full px-2.5 py-0.5"
                style={{
                  background: "var(--fp-surface-sunk)",
                  color: "var(--fp-ink-2)",
                  fontSize: "var(--fp-text-xs)",
                  fontWeight: 600,
                }}
              >
                {s.category_label}
              </span>
            </div>

            {s.prior_rejections > 0 ? (
              <p
                className="mt-3 rounded-xl px-3.5 py-2"
                style={{
                  background: "var(--fp-pending-wash)",
                  color: "var(--fp-pending)",
                  fontSize: "var(--fp-text-sm)",
                  fontWeight: 500,
                }}
              >
                {s.prior_rejections} earlier listing
                {s.prior_rejections === 1 ? "" : "s"} from this neighbour {s.prior_rejections === 1 ? "was" : "were"} turned down.
              </p>
            ) : null}

            <h3
              style={{
                fontFamily: "var(--fp-font-display)",
                fontSize: "var(--fp-text-lg)",
                marginTop: "var(--fp-space-3)",
              }}
            >
              {s.title}
            </h3>
            {s.description ? (
              <p
                style={{
                  fontSize: "var(--fp-text-base)",
                  color: "var(--fp-ink-2)",
                  marginTop: 4,
                  whiteSpace: "pre-wrap",
                }}
              >
                {s.description}
              </p>
            ) : null}
            {s.availability || s.rate_note ? (
              <p style={{ fontSize: "var(--fp-text-sm)", color: "var(--fp-ink-3)", marginTop: 6 }}>
                {[s.availability, s.rate_note].filter(Boolean).join(" · ")}
              </p>
            ) : null}

            {rejecting === s.id ? (
              <div className="mt-4">
                <label className="block">
                  <span className="fp-eyebrow">Why it is not going up</span>
                  <input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="This reads as an advert for an outside business."
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
                    onClick={() => setRejecting(null)}
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
                    disabled={pending || reason.trim().length < 3}
                    onClick={() => act(s.id, false)}
                    className="fp-tap flex-1 rounded-xl"
                    style={{
                      background: "var(--fp-rejected)",
                      color: "var(--fp-ink-inverse)",
                      fontSize: "var(--fp-text-base)",
                      fontWeight: 600,
                      opacity: pending || reason.trim().length < 3 ? 0.5 : 1,
                    }}
                  >
                    Send the decline
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setRejecting(s.id);
                    setReason("");
                  }}
                  className="fp-tap flex-1 rounded-xl"
                  style={{
                    border: "1px solid var(--fp-line)",
                    fontSize: "var(--fp-text-base)",
                    fontWeight: 500,
                  }}
                >
                  Not this one
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => act(s.id, true)}
                  className="fp-tap flex-1 rounded-xl"
                  style={{
                    background: "var(--fp-forest)",
                    color: "var(--fp-ink-inverse)",
                    fontSize: "var(--fp-text-base)",
                    fontWeight: 600,
                    opacity: pending ? 0.6 : 1,
                  }}
                >
                  Publish it
                </button>
              </div>
            )}
          </article>
        ))}
      </div>
    </>
  );
}
