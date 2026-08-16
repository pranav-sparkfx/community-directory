"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Icon } from "@/components/ui/Icon";
import { redeemInvite } from "./actions";

/**
 * The accept button, and only the accept button.
 *
 * Everything above it on the page is server-rendered from preview_invite(),
 * so a visitor who has not signed in yet still sees which neighbourhood is
 * asking before they are sent to create an account.
 */
export function RedeemPanel({
  code,
  address,
  signedIn,
}: {
  code: string;
  address: string | null;
  signedIn: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!signedIn) {
    return (
      <a
        href={`/sign-in?next=${encodeURIComponent(`/invite/${code}`)}`}
        className="fp-tap flex w-full items-center justify-center rounded-xl"
        style={{
          background: "var(--fp-forest)",
          color: "var(--fp-ink-inverse)",
          fontSize: "var(--fp-text-base)",
          fontWeight: 600,
        }}
      >
        Sign in to accept
      </a>
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

      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const r = await redeemInvite(code);
            if (!r.ok) {
              setError(r.error ?? "That invite could not be accepted.");
              return;
            }
            router.push(r.next ?? "/");
            router.refresh();
          });
        }}
        className="fp-tap flex w-full items-center justify-center gap-2 rounded-xl"
        style={{
          background: "var(--fp-forest)",
          color: "var(--fp-ink-inverse)",
          fontSize: "var(--fp-text-base)",
          fontWeight: 600,
          opacity: pending ? 0.6 : 1,
        }}
      >
        <Icon name="check" size={18} strokeWidth={2.2} />
        {pending ? "Joining…" : "Accept and join"}
      </button>

      <p
        style={{
          fontSize: "var(--fp-text-sm)",
          color: "var(--fp-ink-3)",
          marginTop: "var(--fp-space-3)",
          textAlign: "center",
        }}
      >
        {address
          ? "Your address is already confirmed on this invite, so the directory opens straight away."
          : "You will be asked which home is yours. An admin confirms it before your neighbours can see you."}
      </p>
    </>
  );
}
