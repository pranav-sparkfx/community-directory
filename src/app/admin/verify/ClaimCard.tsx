"use client";

import { useState, useTransition } from "react";
import { AvatarMonogram } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icon";
import { decideClaim, lookupAddresses, matchClaim } from "./actions";
import { shortDate } from "@/lib/utils";

export type QueueRow = {
  request_id: string;
  profile_id: string;
  name: string;
  email: string | null;
  claimed_household_id: string | null;
  claimed_address: string | null;
  address_is_known: boolean;
  occupied_by_count: number;
  note: string | null;
  created_at: string;
};

/**
 * One residency claim, and the decision.
 *
 * The card is built around the question an admin is actually answering —
 * "does this person live at this address?" — so it leads with their words and
 * the state of the address, not with two buttons. Approve stays unavailable
 * until the claim points at a real pin, because approving prose would attach
 * a person to nothing.
 */
export function ClaimCard({ row, communityId }: { row: QueueRow; communityId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  const [denying, setDenying] = useState(false);
  const [reason, setReason] = useState("");
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<{ id: string; label: string; taken: boolean }[]>([]);
  const [matched, setMatched] = useState<string | null>(
    row.address_is_known ? row.claimed_address : null,
  );

  if (gone) return null;

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, onDone?: () => void) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "That did not go through.");
      else onDone?.();
    });
  }

  return (
    <article className="fp-card px-4 py-4">
      <div className="flex items-start gap-3.5">
        <AvatarMonogram name={row.name} size={44} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <h2 style={{ fontSize: "var(--fp-text-md)" }}>{row.name}</h2>
            <span style={{ fontSize: "var(--fp-text-xs)", color: "var(--fp-ink-3)" }}>
              {shortDate(row.created_at)}
            </span>
          </div>
          {row.email ? (
            <p style={{ fontSize: "var(--fp-text-sm)", color: "var(--fp-ink-3)" }}>{row.email}</p>
          ) : null}

          {/* ---- the claim ---- */}
          <div
            className="mt-3 rounded-xl px-3 py-2.5"
            style={{ background: "var(--fp-surface-sunk)" }}
          >
            <div className="flex items-center gap-2">
              <Icon name="home" size={16} strokeWidth={1.8} />
              <span style={{ fontSize: "var(--fp-text-base)", fontWeight: 500 }}>
                {matched ?? row.claimed_address ?? "No address given"}
              </span>
            </div>
            {!matched ? (
              <p style={{ fontSize: "var(--fp-text-sm)", color: "var(--fp-pending)", marginTop: 4 }}>
                Typed by hand — match it to a home before approving.
              </p>
            ) : row.occupied_by_count > 0 ? (
              <p style={{ fontSize: "var(--fp-text-sm)", color: "var(--fp-ink-3)", marginTop: 4 }}>
                {row.occupied_by_count} confirmed resident
                {row.occupied_by_count === 1 ? "" : "s"} already here.
              </p>
            ) : null}
          </div>

          {row.note ? (
            <p
              style={{
                fontSize: "var(--fp-text-base)",
                color: "var(--fp-ink-2)",
                marginTop: 10,
                maxWidth: "50ch",
              }}
            >
              “{row.note}”
            </p>
          ) : null}

          {/* ---- match an unmatched claim ---- */}
          {!matched ? (
            <div className="mt-3">
              <input
                value={query}
                onChange={async (e) => {
                  const v = e.target.value;
                  setQuery(v);
                  setMatches(await lookupAddresses(communityId, v));
                }}
                placeholder="Find the home…"
                aria-label="Find the home this claim refers to"
                style={{
                  background: "var(--fp-surface)",
                  border: "1px solid var(--fp-line)",
                  borderRadius: "var(--fp-radius-md)",
                  fontSize: "var(--fp-text-base)",
                  padding: "0 var(--fp-space-3)",
                  height: 40,
                  width: "100%",
                }}
              />
              {matches.length > 0 ? (
                <ul className="mt-1.5" style={{ maxHeight: 168, overflowY: "auto" }}>
                  {matches.map((m) => (
                    <li key={m.id}>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() =>
                          run(
                            () => matchClaim(row.request_id, m.id),
                            () => {
                              setMatched(m.label);
                              setMatches([]);
                              setQuery("");
                            },
                          )
                        }
                        className="flex w-full items-center justify-between px-3 py-2 text-left"
                        style={{
                          fontSize: "var(--fp-text-sm)",
                          borderBottom: "1px solid var(--fp-line)",
                        }}
                      >
                        {m.label}
                        {m.taken ? (
                          <span style={{ color: "var(--fp-ink-3)" }}>occupied</span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          {error ? (
            <p
              role="alert"
              style={{ fontSize: "var(--fp-text-sm)", color: "var(--fp-rejected)", marginTop: 8 }}
            >
              {error}
            </p>
          ) : null}

          {/* ---- decision ---- */}
          {denying ? (
            <div className="mt-3">
              <label
                style={{ fontSize: "var(--fp-text-sm)", color: "var(--fp-ink-2)", fontWeight: 500 }}
              >
                Why? They will see this.
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="That address is already confirmed to another owner."
                  style={{
                    background: "var(--fp-surface)",
                    border: "1px solid var(--fp-line)",
                    borderRadius: "var(--fp-radius-md)",
                    fontSize: "var(--fp-text-base)",
                    padding: "0 var(--fp-space-3)",
                    height: 40,
                    width: "100%",
                    marginTop: 6,
                  }}
                />
              </label>
              <div className="mt-2.5 flex gap-2">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    run(() => decideClaim(row.request_id, false, reason), () => setGone(true))
                  }
                  className="fp-tap flex-1 rounded-xl"
                  style={{
                    background: "var(--fp-rejected)",
                    color: "var(--fp-ink-inverse)",
                    fontSize: "var(--fp-text-sm)",
                    fontWeight: 600,
                  }}
                >
                  {pending ? "Sending…" : "Send the decline"}
                </button>
                <button
                  type="button"
                  onClick={() => setDenying(false)}
                  className="fp-tap rounded-xl px-4"
                  style={{ border: "1px solid var(--fp-line)", fontSize: "var(--fp-text-sm)" }}
                >
                  Back
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-3.5 flex gap-2">
              <button
                type="button"
                disabled={pending || !matched}
                title={matched ? undefined : "Match this claim to a home first"}
                onClick={() =>
                  run(() => decideClaim(row.request_id, true), () => setGone(true))
                }
                className="fp-tap flex-1 rounded-xl"
                style={{
                  background: "var(--fp-forest)",
                  color: "var(--fp-ink-inverse)",
                  fontSize: "var(--fp-text-sm)",
                  fontWeight: 600,
                  opacity: pending || !matched ? 0.45 : 1,
                }}
              >
                {pending ? "Working…" : "They live here"}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => setDenying(true)}
                className="fp-tap rounded-xl px-4"
                style={{
                  border: "1px solid var(--fp-line)",
                  color: "var(--fp-ink-2)",
                  fontSize: "var(--fp-text-sm)",
                  fontWeight: 600,
                }}
              >
                Decline
              </button>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
