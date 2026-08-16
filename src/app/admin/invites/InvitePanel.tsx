"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Icon } from "@/components/ui/Icon";
import { createInvite, lookupAddresses, revokeInvite } from "./actions";

export type Invite = {
  id: string;
  code: string;
  email: string | null;
  role: string;
  address: string | null;
  max_uses: number;
  use_count: number;
  expires_at: string | null;
  created_by: string;
  state: "active" | "revoked" | "expired" | "used up";
};

type Address = { id: string; label: string; taken: boolean };

const KINDS = [
  {
    value: "link" as const,
    label: "Link",
    detail: "One link, many neighbours. Put it in the newsletter or the group chat.",
  },
  {
    value: "email" as const,
    label: "Email",
    detail: "Tied to one address. Only that person can use it.",
  },
  {
    value: "house" as const,
    label: "This house",
    detail:
      "You pick the home. Whoever accepts is confirmed on the spot — no claim to review.",
  },
];

/**
 * Minting and managing invites.
 *
 * The three "kinds" are one row in the database with different fields set;
 * they are separated here because from an admin's side they are genuinely
 * different jobs, and collapsing them into a form with six optional inputs
 * would make the safe default (a plain link) the fiddliest option.
 */
export function InvitePanel({
  communityId,
  initial,
  canGrantModerator,
  canGrantAdmin,
  origin,
}: {
  communityId: string;
  initial: Invite[];
  canGrantModerator: boolean;
  canGrantAdmin: boolean;
  origin: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [minted, setMinted] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const [kind, setKind] = useState<"link" | "email" | "house">("link");
  const [role, setRole] = useState("resident");
  const [email, setEmail] = useState("");
  const [maxUses, setMaxUses] = useState(25);

  const [addressQ, setAddressQ] = useState("");
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [picked, setPicked] = useState<Address | null>(null);
  const latest = useRef(0);

  // Debounced, stamped: a slow response for an earlier keystroke must never
  // overwrite the list for a later one.
  useEffect(() => {
    if (kind !== "house" || addressQ.trim().length < 2 || picked) return;
    const stamp = ++latest.current;
    const t = setTimeout(async () => {
      const rows = await lookupAddresses(communityId, addressQ);
      if (stamp === latest.current) setAddresses(rows);
    }, 200);
    return () => clearTimeout(t);
  }, [addressQ, kind, picked, communityId]);

  function mint() {
    setError(null);
    setMinted(null);
    startTransition(async () => {
      const r = await createInvite({
        communityId,
        role,
        email: kind === "email" ? email : undefined,
        householdId: kind === "house" ? (picked?.id ?? null) : null,
        maxUses: kind === "link" ? maxUses : 1,
        expiresInDays: 30,
      });
      if (!r.ok) {
        setError(r.error ?? "That invite could not be created.");
        return;
      }
      setMinted(r.code ?? null);
      setEmail("");
      setPicked(null);
      setAddressQ("");
      // Clearing the query is not enough: the effect that fills this list
      // is gated on a query of 2+ characters, so an emptied box leaves the
      // last results hanging underneath it with nothing to explain them.
      setAddresses([]);
      router.refresh();
    });
  }

  async function copy(code: string) {
    const url = `${origin}/invite/${code}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(code);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setError(`Copy did not work. The link is ${url}`);
    }
  }

  const ready =
    kind === "link" ||
    (kind === "email" && email.includes("@")) ||
    (kind === "house" && picked !== null);

  return (
    <>
      {error ? <Banner tone="bad">{error}</Banner> : null}

      <section className="mb-8">
        <h2 className="fp-eyebrow">Invite someone</h2>

        <div className="mt-3 flex gap-1 rounded-xl p-1" style={{ background: "var(--fp-surface-sunk)" }} role="radiogroup" aria-label="Kind of invite">
          {KINDS.map((k) => {
            const active = k.value === kind;
            return (
              <button
                key={k.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => {
                  setKind(k.value);
                  setMinted(null);
                }}
                className="flex-1 rounded-lg"
                style={{
                  minHeight: 38,
                  background: active ? "var(--fp-surface)" : "transparent",
                  color: active ? "var(--fp-ink)" : "var(--fp-ink-3)",
                  fontSize: "var(--fp-text-sm)",
                  fontWeight: active ? 600 : 500,
                  boxShadow: active ? "var(--fp-shadow-raised)" : "none",
                }}
              >
                {k.label}
              </button>
            );
          })}
        </div>

        <p
          style={{
            fontSize: "var(--fp-text-sm)",
            color: "var(--fp-ink-3)",
            marginTop: 8,
            maxWidth: "52ch",
          }}
        >
          {KINDS.find((k) => k.value === kind)!.detail}
        </p>

        <div className="fp-card mt-3 px-4 py-4">
          {kind === "email" ? (
            <label className="block">
              <span className="fp-eyebrow">Their email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="neighbour@example.com"
                className="mt-1.5 w-full rounded-xl px-3.5"
                style={{
                  minHeight: 44,
                  border: "1px solid var(--fp-line)",
                  background: "var(--fp-surface)",
                  fontSize: "var(--fp-text-base)",
                }}
              />
            </label>
          ) : null}

          {kind === "link" ? (
            <label className="block">
              <span className="fp-eyebrow">How many people may use it</span>
              <input
                type="number"
                min={1}
                max={500}
                value={maxUses}
                onChange={(e) => setMaxUses(Number(e.target.value))}
                className="mt-1.5 w-full rounded-xl px-3.5 tabular-nums"
                style={{
                  minHeight: 44,
                  border: "1px solid var(--fp-line)",
                  background: "var(--fp-surface)",
                  fontSize: "var(--fp-text-base)",
                }}
              />
            </label>
          ) : null}

          {kind === "house" ? (
            picked ? (
              <div className="flex items-center gap-3">
                <span
                  className="inline-flex shrink-0 items-center justify-center rounded-full"
                  style={{
                    width: 36,
                    height: 36,
                    background: "var(--fp-forest-wash)",
                    color: "var(--fp-forest)",
                  }}
                >
                  <Icon name="home" size={18} />
                </span>
                <p className="min-w-0 flex-1" style={{ fontSize: "var(--fp-text-base)", fontWeight: 500 }}>
                  {picked.label}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setPicked(null);
                    setAddressQ("");
                    setAddresses([]);
                  }}
                  aria-label="Choose a different address"
                  className="fp-tap shrink-0 rounded-full px-3"
                  style={{ border: "1px solid var(--fp-line)", fontSize: "var(--fp-text-sm)", minHeight: 36 }}
                >
                  Change
                </button>
              </div>
            ) : (
              <>
                <label className="block">
                  <span className="fp-eyebrow">Which home</span>
                  <input
                    value={addressQ}
                    onChange={(e) => setAddressQ(e.target.value)}
                    placeholder="Start typing an address"
                    autoComplete="off"
                    className="mt-1.5 w-full rounded-xl px-3.5"
                    style={{
                      minHeight: 44,
                      border: "1px solid var(--fp-line)",
                      background: "var(--fp-surface)",
                      fontSize: "var(--fp-text-base)",
                    }}
                  />
                </label>
                {addresses.length > 0 ? (
                  <ul className="mt-2" style={{ display: "grid", gap: 2 }}>
                    {addresses.map((a) => (
                      <li key={a.id}>
                        <button
                          type="button"
                          onClick={() => setPicked(a)}
                          className="fp-tap flex w-full items-center gap-2 rounded-lg px-3 text-left"
                          style={{ fontSize: "var(--fp-text-base)" }}
                        >
                          <span className="min-w-0 flex-1 truncate">{a.label}</span>
                          {a.taken ? (
                            <span
                              className="shrink-0"
                              style={{ fontSize: "var(--fp-text-xs)", color: "var(--fp-ink-3)" }}
                            >
                              someone lives here
                            </span>
                          ) : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            )
          ) : null}

          {canGrantModerator ? (
            <label className="mt-4 block">
              <span className="fp-eyebrow">Joining as</span>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="mt-1.5 w-full rounded-xl px-3"
                style={{
                  minHeight: 44,
                  border: "1px solid var(--fp-line)",
                  background: "var(--fp-surface)",
                  fontSize: "var(--fp-text-base)",
                }}
              >
                <option value="resident">Resident</option>
                <option value="moderator">Moderator</option>
                {canGrantAdmin ? <option value="admin">Admin</option> : null}
              </select>
            </label>
          ) : null}

          <button
            type="button"
            disabled={pending || !ready}
            onClick={mint}
            className="fp-tap mt-4 flex w-full items-center justify-center gap-2 rounded-xl"
            style={{
              background: "var(--fp-forest)",
              color: "var(--fp-ink-inverse)",
              fontSize: "var(--fp-text-base)",
              fontWeight: 600,
              opacity: pending || !ready ? 0.5 : 1,
            }}
          >
            <Icon name="plus" size={18} strokeWidth={2} />
            {pending ? "Creating…" : "Create invite"}
          </button>
        </div>

        {minted ? (
          <div
            className="fp-card mt-3 px-4 py-4"
            style={{ borderColor: "var(--fp-forest)", borderWidth: 1.5 }}
          >
            <p className="fp-eyebrow">Ready to send</p>
            <p
              className="mt-2 tabular-nums"
              // Hooked for tests: the code is a bare string with no role or
              // label of its own, and the sent-invites list below repeats the
              // same shape, so "the first 8-character code on the page" is
              // ambiguous by construction.
              data-testid="minted-code"
              style={{
                fontFamily: "var(--fp-font-display)",
                fontSize: "var(--fp-text-2xl)",
                letterSpacing: "0.14em",
              }}
            >
              {minted}
            </p>
            <p
              style={{
                fontSize: "var(--fp-text-sm)",
                color: "var(--fp-ink-3)",
                marginTop: 4,
                wordBreak: "break-all",
              }}
            >
              {origin}/invite/{minted}
            </p>
            <button
              type="button"
              onClick={() => copy(minted)}
              className="fp-tap mt-3 flex w-full items-center justify-center gap-2 rounded-xl"
              style={{
                border: "1px solid var(--fp-line)",
                fontSize: "var(--fp-text-base)",
                fontWeight: 600,
              }}
            >
              <Icon name={copied === minted ? "check" : "link"} size={17} strokeWidth={2} />
              {copied === minted ? "Copied" : "Copy the link"}
            </button>
          </div>
        ) : null}
      </section>

      <section>
        <h2 className="fp-eyebrow">Invites you have sent</h2>
        <div className="mt-3" style={{ display: "grid", gap: "var(--fp-space-2)" }}>
          {initial.length === 0 ? (
            <p style={{ fontSize: "var(--fp-text-base)", color: "var(--fp-ink-3)" }}>
              None yet.
            </p>
          ) : null}
          {initial.map((i) => {
            const live = i.state === "active";
            return (
              <div key={i.id} className="fp-card px-4 py-3.5" style={{ opacity: live ? 1 : 0.62 }}>
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p
                      className="tabular-nums"
                      style={{
                        fontFamily: "var(--fp-font-display)",
                        fontSize: "var(--fp-text-lg)",
                        letterSpacing: "0.1em",
                      }}
                    >
                      {i.code}
                    </p>
                    <p style={{ fontSize: "var(--fp-text-sm)", color: "var(--fp-ink-3)", marginTop: 2 }}>
                      {i.email ?? i.address ?? `Open link · ${i.use_count}/${i.max_uses} used`}
                      {i.role !== "resident" ? ` · as ${i.role}` : ""}
                    </p>
                    {!live ? (
                      <span
                        className="mt-2 inline-flex items-center rounded-full px-2.5 py-0.5"
                        style={{
                          background: "var(--fp-surface-sunk)",
                          color: "var(--fp-ink-3)",
                          fontSize: "var(--fp-text-xs)",
                          fontWeight: 600,
                          textTransform: "capitalize",
                        }}
                      >
                        {i.state}
                      </span>
                    ) : null}
                  </div>
                  {live ? (
                    <div className="flex shrink-0 gap-1.5">
                      <button
                        type="button"
                        onClick={() => copy(i.code)}
                        aria-label={`Copy the link for ${i.code}`}
                        className="fp-tap rounded-full px-3"
                        style={{
                          border: "1px solid var(--fp-line)",
                          fontSize: "var(--fp-text-sm)",
                          minHeight: 36,
                        }}
                      >
                        {copied === i.code ? "Copied" : "Copy"}
                      </button>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() =>
                          startTransition(async () => {
                            const r = await revokeInvite(i.id);
                            if (!r.ok) setError(r.error ?? "Could not revoke that.");
                            router.refresh();
                          })
                        }
                        aria-label={`Revoke ${i.code}`}
                        className="fp-tap rounded-full px-3"
                        style={{
                          border: "1px solid var(--fp-line)",
                          color: "var(--fp-rejected)",
                          fontSize: "var(--fp-text-sm)",
                          minHeight: 36,
                        }}
                      >
                        Revoke
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}

function Banner({ tone, children }: { tone: "good" | "bad"; children: React.ReactNode }) {
  return (
    <p
      role={tone === "bad" ? "alert" : "status"}
      className="mb-5 rounded-xl px-4 py-3"
      style={{
        background: tone === "bad" ? "var(--fp-rejected-wash)" : "var(--fp-verified-wash)",
        color: tone === "bad" ? "var(--fp-rejected)" : "var(--fp-verified)",
        fontSize: "var(--fp-text-base)",
      }}
    >
      {children}
    </p>
  );
}
