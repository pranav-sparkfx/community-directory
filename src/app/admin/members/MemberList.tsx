"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AvatarMonogram } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icon";
import { StatusPill } from "@/components/ui/Controls";
import { removeMember, searchMembers, setMemberRole } from "./actions";

export type Member = {
  membership_id: string;
  profile_id: string;
  name: string;
  email: string;
  role: "resident" | "moderator" | "admin" | "owner";
  rank: number;
  status: "unverified" | "pending" | "verified" | "rejected";
  address: string | null;
  is_owner: boolean;
  is_self: boolean;
};

const FILTERS = [
  { value: "all", label: "Everyone" },
  { value: "admin", label: "Admins" },
  { value: "moderator", label: "Moderators" },
  { value: "resident", label: "Residents" },
];

const ROLES: { value: "resident" | "moderator" | "admin"; label: string; detail: string }[] = [
  { value: "resident", label: "Resident", detail: "Sees the directory. Nothing more." },
  {
    value: "moderator",
    label: "Moderator",
    detail: "Also reviews service listings, reports and invites.",
  },
  {
    value: "admin",
    label: "Admin",
    detail: "Also confirms residency, sets roles and edits the community.",
  },
];

/**
 * The member list.
 *
 * Controls are shown by rank, not by hope: a row for someone at or above the
 * viewer's own rank carries no buttons at all, because the RPC behind them
 * would refuse. Offering a control that always fails is worse than not
 * offering it.
 */
export function MemberList({
  communityId,
  initial,
  viewerRank,
}: {
  communityId: string;
  initial: Member[];
  viewerRank: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [members, setMembers] = useState(initial);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [error, setError] = useState<string | null>(null);
  const [openFor, setOpenFor] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Member | null>(null);
  const [reason, setReason] = useState("");

  function reload(nextQ = q, nextFilter = filter) {
    startTransition(async () => {
      setMembers((await searchMembers(communityId, nextQ, nextFilter)) as Member[]);
    });
  }

  function act(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) {
        setError(r.error ?? "That did not work.");
        return;
      }
      setOpenFor(null);
      setRemoving(null);
      setReason("");
      setMembers((await searchMembers(communityId, q, filter)) as Member[]);
      router.refresh();
    });
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

      <form
        onSubmit={(e) => {
          e.preventDefault();
          reload();
        }}
        className="mb-3"
      >
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, email or address"
          aria-label="Search members"
          className="w-full rounded-xl px-3.5"
          style={{
            minHeight: 44,
            border: "1px solid var(--fp-line)",
            background: "var(--fp-surface)",
            fontSize: "var(--fp-text-base)",
          }}
        />
      </form>

      <div className="mb-5 flex gap-1.5 overflow-x-auto pb-1">
        {FILTERS.map((f) => {
          const active = f.value === filter;
          return (
            <button
              key={f.value}
              type="button"
              aria-pressed={active}
              onClick={() => {
                setFilter(f.value);
                reload(q, f.value);
              }}
              className="shrink-0 rounded-full px-3.5"
              style={{
                minHeight: 34,
                background: active ? "var(--fp-forest)" : "var(--fp-surface)",
                color: active ? "var(--fp-ink-inverse)" : "var(--fp-ink-2)",
                border: `1px solid ${active ? "var(--fp-forest)" : "var(--fp-line)"}`,
                fontSize: "var(--fp-text-sm)",
                fontWeight: 500,
              }}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      <p
        style={{
          fontSize: "var(--fp-text-sm)",
          color: "var(--fp-ink-3)",
          marginBottom: "var(--fp-space-3)",
        }}
      >
        {members.length} {members.length === 1 ? "person" : "people"}
        {pending ? " · updating…" : ""}
      </p>

      <div style={{ display: "grid", gap: "var(--fp-space-2)" }}>
        {members.map((m) => {
          const actionable = !m.is_self && !m.is_owner && m.rank < viewerRank;
          return (
            <div key={m.membership_id} className="fp-card px-4 py-3.5">
              <div className="flex items-start gap-3">
                <AvatarMonogram name={m.name} size={40} />
                <div className="min-w-0 flex-1">
                  <p style={{ fontSize: "var(--fp-text-base)", fontWeight: 500 }}>
                    {m.name}
                    {m.is_self ? (
                      <span
                        style={{
                          fontSize: "var(--fp-text-xs)",
                          color: "var(--fp-ink-3)",
                          fontWeight: 500,
                          marginLeft: 6,
                        }}
                      >
                        you
                      </span>
                    ) : null}
                  </p>
                  <p
                    className="truncate"
                    style={{ fontSize: "var(--fp-text-sm)", color: "var(--fp-ink-3)" }}
                  >
                    {m.address ?? "No address confirmed"}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <RoleChip role={m.role} />
                    {m.status !== "verified" ? <StatusPill status={m.status} /> : null}
                  </div>
                </div>

                {actionable ? (
                  <button
                    type="button"
                    aria-label={`Manage ${m.name}`}
                    aria-expanded={openFor === m.profile_id}
                    onClick={() =>
                      setOpenFor(openFor === m.profile_id ? null : m.profile_id)
                    }
                    className="fp-tap shrink-0 rounded-full px-3"
                    style={{
                      border: "1px solid var(--fp-line)",
                      fontSize: "var(--fp-text-sm)",
                      fontWeight: 500,
                      minHeight: 36,
                    }}
                  >
                    Manage
                  </button>
                ) : null}
              </div>

              {openFor === m.profile_id ? (
                <div
                  className="mt-3.5 pt-3.5"
                  style={{ borderTop: "1px solid var(--fp-line)" }}
                >
                  <p className="fp-eyebrow">Role</p>
                  <div className="mt-2" style={{ display: "grid", gap: 6 }}>
                    {ROLES.filter((r) => {
                      // You cannot grant your own rank or above; showing the
                      // option would only produce a refusal.
                      const rank = { resident: 1, moderator: 2, admin: 3 }[r.value];
                      return rank < viewerRank;
                    }).map((r) => {
                      const current = r.value === m.role;
                      return (
                        <button
                          key={r.value}
                          type="button"
                          disabled={current || pending}
                          onClick={() =>
                            act(() => setMemberRole(communityId, m.profile_id, r.value))
                          }
                          className="flex items-start gap-2.5 rounded-xl px-3 py-2.5 text-left"
                          style={{
                            background: current
                              ? "var(--fp-surface-sunk)"
                              : "transparent",
                            border: `1px solid ${current ? "transparent" : "var(--fp-line)"}`,
                          }}
                        >
                          <span
                            className="mt-0.5 shrink-0"
                            style={{ color: current ? "var(--fp-forest)" : "transparent" }}
                          >
                            <Icon name="check" size={16} strokeWidth={2.4} />
                          </span>
                          <span className="min-w-0">
                            <span
                              className="block"
                              style={{
                                fontSize: "var(--fp-text-base)",
                                fontWeight: current ? 600 : 500,
                              }}
                            >
                              {r.label}
                            </span>
                            <span
                              className="block"
                              style={{
                                fontSize: "var(--fp-text-sm)",
                                color: "var(--fp-ink-3)",
                              }}
                            >
                              {r.detail}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {removing?.profile_id === m.profile_id ? (
                    <div className="mt-4">
                      <label className="block">
                        <span className="fp-eyebrow">Why they are being removed</span>
                        <input
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                          placeholder="Sold the house in June."
                          className="mt-1.5 w-full rounded-xl px-3.5"
                          style={{
                            minHeight: 44,
                            border: "1px solid var(--fp-line)",
                            background: "var(--fp-surface)",
                            fontSize: "var(--fp-text-base)",
                          }}
                        />
                      </label>
                      <p
                        style={{
                          fontSize: "var(--fp-text-sm)",
                          color: "var(--fp-ink-3)",
                          marginTop: 6,
                        }}
                      >
                        They are told, and they keep their account. Their name comes off
                        the household as moved out, so the address history survives.
                      </p>
                      <div className="mt-3 flex gap-2">
                        <button
                          type="button"
                          onClick={() => setRemoving(null)}
                          className="fp-tap flex-1 rounded-xl"
                          style={{
                            border: "1px solid var(--fp-line)",
                            fontSize: "var(--fp-text-base)",
                            fontWeight: 500,
                          }}
                        >
                          Keep them
                        </button>
                        <button
                          type="button"
                          disabled={pending || reason.trim().length < 3}
                          onClick={() =>
                            act(() => removeMember(communityId, m.profile_id, reason))
                          }
                          className="fp-tap flex-1 rounded-xl"
                          style={{
                            background: "var(--fp-rejected)",
                            color: "var(--fp-ink-inverse)",
                            fontSize: "var(--fp-text-base)",
                            fontWeight: 600,
                            opacity: pending || reason.trim().length < 3 ? 0.5 : 1,
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setRemoving(m)}
                      className="fp-tap mt-3 w-full rounded-xl"
                      style={{
                        border: "1px solid var(--fp-rejected)",
                        color: "var(--fp-rejected)",
                        fontSize: "var(--fp-text-base)",
                        fontWeight: 500,
                      }}
                    >
                      Remove from this community
                    </button>
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </>
  );
}

function RoleChip({ role }: { role: Member["role"] }) {
  const staff = role !== "resident";
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5"
      style={{
        background: staff ? "var(--fp-forest-wash)" : "var(--fp-surface-sunk)",
        color: staff ? "var(--fp-forest)" : "var(--fp-ink-3)",
        fontSize: "var(--fp-text-xs)",
        fontWeight: 600,
        textTransform: "capitalize",
      }}
    >
      {role}
    </span>
  );
}
