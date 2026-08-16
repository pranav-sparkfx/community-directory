"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Icon } from "@/components/ui/Icon";
import { StatusPill } from "@/components/ui/Controls";
import {
  joinPublicCommunity,
  proposeCommunity,
  searchCommunities,
  switchCommunity,
} from "./actions";

export type Mine = {
  id: string;
  name: string;
  parent_name: string | null;
  depth: number;
  role: "resident" | "moderator" | "admin" | "owner";
  status: "unverified" | "pending" | "verified" | "rejected";
  visibility: "public" | "private";
  member_count: number;
  is_owner: boolean;
};

type Found = {
  id: string;
  name: string;
  parent_name: string | null;
  description: string | null;
  member_count: number;
};

const ROLE_LABEL: Record<Mine["role"], string> = {
  resident: "Resident",
  moderator: "Moderator",
  admin: "Admin",
  owner: "Owner",
};

/**
 * The neighbourhoods this person belongs to, plus the two ways to get into
 * another one: find a public community, or start your own.
 *
 * The active community is marked rather than hidden. Someone who belongs to
 * an HOA and to their own street needs to see both at once to understand why
 * the map showed what it showed.
 */
export function CommunityList({
  mine,
  activeId,
  canProposeUnder,
}: {
  mine: Mine[];
  activeId: string | null;
  canProposeUnder: { id: string; name: string } | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [found, setFound] = useState<Found[] | null>(null);

  const [newName, setNewName] = useState("");
  const [newNote, setNewNote] = useState("");
  const [underParent, setUnderParent] = useState(Boolean(canProposeUnder));

  function run(fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) {
        setError(r.error ?? "That did not work.");
        return;
      }
      if (r.message) setNotice(r.message);
      router.refresh();
    });
  }

  return (
    <>
      {error ? <Banner tone="bad">{error}</Banner> : null}
      {notice ? <Banner tone="good">{notice}</Banner> : null}

      <Group title="Your neighbourhoods">
        <div style={{ display: "grid", gap: "var(--fp-space-2)" }}>
          {mine.map((c) => {
            const active = c.id === activeId;
            return (
              <div
                key={c.id}
                className="fp-card px-4 py-3.5"
                style={{
                  borderColor: active ? "var(--fp-forest)" : undefined,
                  borderWidth: active ? 1.5 : undefined,
                }}
              >
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    {c.parent_name ? (
                      <p
                        style={{
                          fontSize: "var(--fp-text-xs)",
                          color: "var(--fp-ink-3)",
                          letterSpacing: "0.04em",
                        }}
                      >
                        {c.parent_name} ›
                      </p>
                    ) : null}
                    <p
                      style={{
                        fontFamily: "var(--fp-font-display)",
                        fontSize: "var(--fp-text-lg)",
                      }}
                    >
                      {c.name}
                    </p>
                    <p
                      style={{
                        fontSize: "var(--fp-text-sm)",
                        color: "var(--fp-ink-3)",
                        marginTop: 2,
                      }}
                    >
                      {ROLE_LABEL[c.role]} · {c.member_count}{" "}
                      {c.member_count === 1 ? "neighbour" : "neighbours"} ·{" "}
                      {c.visibility === "public" ? "Public" : "Invite only"}
                    </p>
                  </div>
                  {active ? (
                    <span
                      className="inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1"
                      style={{
                        background: "var(--fp-forest)",
                        color: "var(--fp-ink-inverse)",
                        fontSize: "var(--fp-text-xs)",
                        fontWeight: 600,
                      }}
                    >
                      <Icon name="check" size={13} strokeWidth={2.2} />
                      Viewing
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => run(() => switchCommunity(c.id))}
                      className="fp-tap shrink-0 rounded-full px-3.5"
                      style={{
                        border: "1px solid var(--fp-line)",
                        fontSize: "var(--fp-text-sm)",
                        fontWeight: 500,
                        minHeight: 36,
                      }}
                    >
                      Switch
                    </button>
                  )}
                </div>
                {c.status !== "verified" ? (
                  <div className="mt-2.5">
                    <StatusPill status={c.status} />
                  </div>
                ) : null}
              </div>
            );
          })}
          {mine.length === 0 ? (
            <p style={{ color: "var(--fp-ink-3)", fontSize: "var(--fp-text-base)" }}>
              You are not in a neighbourhood yet. Find one below, or start your own.
            </p>
          ) : null}
        </div>
      </Group>

      <Group
        title="Find a neighbourhood"
        note="Only communities that chose to be public appear here. Private ones are reached by invite."
      >
        <div className="flex gap-2">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name"
            aria-label="Search public communities"
            className="min-w-0 flex-1 rounded-xl px-3.5"
            style={{
              minHeight: 44,
              border: "1px solid var(--fp-line)",
              background: "var(--fp-surface)",
              fontSize: "var(--fp-text-base)",
            }}
          />
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                setFound(await searchCommunities(q));
              })
            }
            className="fp-tap shrink-0 rounded-xl px-4"
            style={{
              background: "var(--fp-forest)",
              color: "var(--fp-ink-inverse)",
              fontSize: "var(--fp-text-base)",
              fontWeight: 600,
            }}
          >
            Search
          </button>
        </div>

        {found ? (
          found.length === 0 ? (
            <p
              style={{
                fontSize: "var(--fp-text-sm)",
                color: "var(--fp-ink-3)",
                marginTop: "var(--fp-space-3)",
              }}
            >
              Nothing public matched that. Most neighbourhoods are invite-only — ask a
              neighbour for a link or a code.
            </p>
          ) : (
            <div className="mt-3" style={{ display: "grid", gap: "var(--fp-space-2)" }}>
              {found.map((c) => (
                <div key={c.id} className="fp-card flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p style={{ fontSize: "var(--fp-text-base)", fontWeight: 500 }}>
                      {c.name}
                    </p>
                    <p style={{ fontSize: "var(--fp-text-sm)", color: "var(--fp-ink-3)" }}>
                      {c.parent_name ? `${c.parent_name} · ` : ""}
                      {c.member_count} {c.member_count === 1 ? "neighbour" : "neighbours"}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run(() => joinPublicCommunity(c.id))}
                    className="fp-tap shrink-0 rounded-full px-3.5"
                    style={{
                      border: "1px solid var(--fp-line)",
                      fontSize: "var(--fp-text-sm)",
                      fontWeight: 500,
                      minHeight: 36,
                    }}
                  >
                    Join
                  </button>
                </div>
              ))}
            </div>
          )
        ) : null}
      </Group>

      <Group
        title="Start a neighbourhood"
        note={
          canProposeUnder
            ? "A sub-community is for a street, a building or a block inside a bigger community — it gets its own map, its own directory and its own local admin."
            : "You will own it, and can invite your neighbours straight away."
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              const r = await proposeCommunity({
                name: newName,
                note: newNote || undefined,
                parentId: underParent && canProposeUnder ? canProposeUnder.id : null,
              });
              if (r.ok) {
                setNewName("");
                setNewNote("");
              }
              return r;
            });
          }}
        >
          <label className="block">
            <span className="fp-eyebrow">Name</span>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Cedar Bend Court"
              required
              className="mt-1.5 w-full rounded-xl px-3.5"
              style={{
                minHeight: 44,
                border: "1px solid var(--fp-line)",
                background: "var(--fp-surface)",
                fontSize: "var(--fp-text-base)",
              }}
            />
          </label>

          {canProposeUnder ? (
            <div
              role="radiogroup"
              aria-label="Where does it sit"
              className="mt-3 flex gap-1 rounded-xl p-1"
              style={{ background: "var(--fp-surface-sunk)" }}
            >
              {[
                { v: true, label: `Inside ${canProposeUnder.name}` },
                { v: false, label: "On its own" },
              ].map((o) => (
                <button
                  key={String(o.v)}
                  type="button"
                  role="radio"
                  aria-checked={underParent === o.v}
                  onClick={() => setUnderParent(o.v)}
                  className="flex-1 rounded-lg"
                  style={{
                    minHeight: 38,
                    background: underParent === o.v ? "var(--fp-surface)" : "transparent",
                    color: underParent === o.v ? "var(--fp-ink)" : "var(--fp-ink-3)",
                    fontSize: "var(--fp-text-sm)",
                    fontWeight: underParent === o.v ? 600 : 500,
                    boxShadow: underParent === o.v ? "var(--fp-shadow-raised)" : "none",
                  }}
                >
                  {o.label}
                </button>
              ))}
            </div>
          ) : null}

          {underParent && canProposeUnder ? (
            <label className="mt-3 block">
              <span className="fp-eyebrow">Why (the admins will read this)</span>
              <textarea
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                rows={3}
                placeholder="The eight of us on the cul-de-sac want our own noticeboard."
                className="mt-1.5 w-full rounded-xl px-3.5 py-2.5"
                style={{
                  border: "1px solid var(--fp-line)",
                  background: "var(--fp-surface)",
                  fontSize: "var(--fp-text-base)",
                  resize: "vertical",
                }}
              />
            </label>
          ) : null}

          <button
            type="submit"
            disabled={pending || newName.trim().length < 3}
            className="fp-tap mt-4 flex w-full items-center justify-center gap-2 rounded-xl"
            style={{
              background: "var(--fp-forest)",
              color: "var(--fp-ink-inverse)",
              fontSize: "var(--fp-text-base)",
              fontWeight: 600,
              opacity: pending || newName.trim().length < 3 ? 0.5 : 1,
            }}
          >
            <Icon name="plus" size={18} strokeWidth={2} />
            {underParent && canProposeUnder ? "Ask the admins" : "Create it"}
          </button>
        </form>
      </Group>
    </>
  );
}

function Group({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8">
      <h2
        style={{
          fontSize: "var(--fp-text-xs)",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--fp-ink-3)",
          fontWeight: 600,
        }}
      >
        {title}
      </h2>
      {note ? (
        <p
          style={{
            fontSize: "var(--fp-text-sm)",
            color: "var(--fp-ink-3)",
            marginTop: 4,
            maxWidth: "52ch",
          }}
        >
          {note}
        </p>
      ) : null}
      <div className="mt-3">{children}</div>
    </section>
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
