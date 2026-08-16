"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { Icon } from "@/components/ui/Icon";
import { searchAddresses, submitClaim, type ClaimState } from "./actions";

type Suggestion = { id: string; label: string; taken: boolean };

const fieldStyle: React.CSSProperties = {
  background: "var(--fp-surface)",
  border: "1px solid var(--fp-line)",
  borderRadius: "var(--fp-radius-md)",
  fontSize: "var(--fp-text-base)",
  padding: "0 var(--fp-space-3)",
  width: "100%",
  color: "var(--fp-ink)",
};

function Submit({ ready }: { ready: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || !ready}
      className="fp-tap w-full rounded-xl"
      style={{
        height: "var(--fp-control-h)",
        background: "var(--fp-forest)",
        color: "var(--fp-ink-inverse)",
        fontSize: "var(--fp-text-base)",
        fontWeight: 600,
        opacity: pending || !ready ? 0.5 : 1,
      }}
    >
      {pending ? "Sending…" : "Send to the admin"}
    </button>
  );
}

/**
 * Claim your address.
 *
 * Two paths, one field. In a public community the box autocompletes against
 * real pins; in a private one the list stays empty by design and the same box
 * accepts typed prose, which an admin matches to a pin later. The resident
 * never has to know which case they are in.
 */
export function ClaimForm({
  communityId,
  communityName,
}: {
  communityId: string;
  communityName: string;
}) {
  const [state, formAction] = useActionState<ClaimState, FormData>(submitClaim, {});
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Suggestion | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [, startTransition] = useTransition();
  const latest = useRef(0);

  useEffect(() => {
    if (picked || query.trim().length < 2) {
      // Queued rather than set inline: a synchronous setState in an effect
      // body renders a second time before the browser paints the first.
      const clear = setTimeout(() => setSuggestions([]), 0);
      return () => clearTimeout(clear);
    }
    // Debounced, and stamped: an earlier response that lands late must not
    // overwrite the list the user is currently looking at.
    const stamp = ++latest.current;
    const t = setTimeout(() => {
      startTransition(async () => {
        const rows = await searchAddresses(communityId, query);
        if (stamp === latest.current) setSuggestions(rows);
      });
    }, 220);
    return () => clearTimeout(t);
  }, [query, picked, communityId]);

  const ready = Boolean(picked || query.trim().length >= 4);

  return (
    <form action={formAction}>
      <input type="hidden" name="community_id" value={communityId} />
      {picked ? <input type="hidden" name="household_id" value={picked.id} /> : null}
      <input type="hidden" name="address" value={picked ? picked.label : query} />

      {state.error ? (
        <p
          role="alert"
          className="mb-5 rounded-xl px-4 py-3"
          style={{
            background: "var(--fp-rejected-wash)",
            color: "var(--fp-rejected)",
            fontSize: "var(--fp-text-base)",
          }}
        >
          {state.error}
        </p>
      ) : null}

      <label style={{ display: "block" }}>
        <span style={{ fontSize: "var(--fp-text-sm)", color: "var(--fp-ink-2)", fontWeight: 500 }}>
          Your address in {communityName}
        </span>
        <span
          style={{ display: "block", fontSize: "var(--fp-text-sm)", color: "var(--fp-ink-3)" }}
        >
          Start typing — we will match it if we can.
        </span>
        <span className="relative mt-2 block">
          <input
            value={picked ? picked.label : query}
            onChange={(e) => {
              setPicked(null);
              setQuery(e.target.value);
            }}
            autoComplete="off"
            spellCheck={false}
            placeholder="1404 Heron Ridge"
            aria-describedby="claim-help"
            style={{ ...fieldStyle, height: "var(--fp-control-h)" }}
          />
          {picked ? (
            <button
              type="button"
              onClick={() => {
                setPicked(null);
                setQuery("");
              }}
              className="absolute inset-y-0 right-3 inline-flex items-center"
              style={{ color: "var(--fp-forest)", fontSize: "var(--fp-text-sm)", fontWeight: 600 }}
            >
              Change
            </button>
          ) : null}
        </span>
      </label>

      {state.fieldErrors?.address ? (
        <p
          role="alert"
          style={{ fontSize: "var(--fp-text-sm)", color: "var(--fp-rejected)", marginTop: 4 }}
        >
          {state.fieldErrors.address}
        </p>
      ) : null}

      {suggestions.length > 0 ? (
        <ul
          className="fp-card mt-2 overflow-hidden"
          style={{ padding: 0 }}
          aria-label="Matching addresses"
        >
          {suggestions.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => {
                  setPicked(s);
                  setSuggestions([]);
                }}
                className="fp-tap flex w-full items-center gap-3 px-4 text-left"
                style={{ borderBottom: "1px solid var(--fp-line)" }}
              >
                <Icon name="home" size={18} strokeWidth={1.7} />
                <span className="flex-1" style={{ fontSize: "var(--fp-text-base)" }}>
                  {s.label}
                </span>
                {s.taken ? (
                  <span style={{ fontSize: "var(--fp-text-xs)", color: "var(--fp-ink-3)" }}>
                    someone lives here
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <label style={{ display: "block", marginTop: "var(--fp-space-5)" }}>
        <span style={{ fontSize: "var(--fp-text-sm)", color: "var(--fp-ink-2)", fontWeight: 500 }}>
          Anything that helps the admin confirm you
        </span>
        <span
          style={{ display: "block", fontSize: "var(--fp-text-sm)", color: "var(--fp-ink-3)" }}
        >
          Optional. Closing date, the neighbour who referred you, your unit number.
        </span>
        <textarea
          name="note"
          rows={3}
          maxLength={400}
          placeholder="We closed on the house on the 3rd — the Kesslers next door know us."
          style={{
            ...fieldStyle,
            marginTop: 6,
            padding: "var(--fp-space-3)",
            lineHeight: 1.5,
            resize: "vertical",
          }}
        />
      </label>

      <div style={{ marginTop: "var(--fp-space-6)" }}>
        <Submit ready={ready} />
      </div>

      <p
        id="claim-help"
        style={{
          fontSize: "var(--fp-text-sm)",
          color: "var(--fp-ink-3)",
          marginTop: "var(--fp-space-4)",
          maxWidth: "52ch",
        }}
      >
        Claiming an address does not open the directory. An admin checks every
        claim against the HOA records first — which is the only reason it is
        safe for the rest of your neighbours to be in here.
      </p>
    </form>
  );
}
