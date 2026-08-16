"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Type in a code.
 *
 * Case and punctuation are normalised here because a code read aloud gets
 * written down with spaces and dashes. Ambiguous characters are deliberately
 * NOT auto-corrected: the alphabet excludes I, O, 0 and 1 precisely so a
 * misread has no valid interpretation, and guessing one would send someone
 * to a stranger's invite. The invite screen names them in its error instead.
 */
export function CodeForm() {
  const router = useRouter();
  const [code, setCode] = useState("");

  const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, "");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (clean.length >= 4) router.push(`/invite/${clean}`);
      }}
      className="mt-6"
    >
      <label className="block">
        <span className="fp-eyebrow">Have a code?</span>
        <input
          value={clean}
          onChange={(e) => setCode(e.target.value)}
          placeholder="ABCD2345"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          maxLength={12}
          aria-label="Invite code"
          className="mt-2 w-full rounded-xl px-4 text-center tabular-nums"
          style={{
            minHeight: 52,
            border: "1px solid var(--fp-line)",
            background: "var(--fp-surface)",
            fontFamily: "var(--fp-font-display)",
            fontSize: "var(--fp-text-xl)",
            letterSpacing: "0.18em",
          }}
        />
      </label>
      <button
        type="submit"
        disabled={clean.length < 4}
        className="fp-tap mt-3 w-full rounded-xl"
        style={{
          background: "var(--fp-forest)",
          color: "var(--fp-ink-inverse)",
          fontSize: "var(--fp-text-base)",
          fontWeight: 600,
          opacity: clean.length < 4 ? 0.4 : 1,
        }}
      >
        Use this code
      </button>
    </form>
  );
}
