"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Icon } from "@/components/ui/Icon";
import { SegmentedRow, SettingGroup } from "@/components/ui/SettingRow";
import { decideCommunityRequest, transferOwnership, updateCommunity } from "./actions";

export type Community = {
  id: string;
  name: string;
  description: string | null;
  visibility: "public" | "private";
};

export type Child = {
  id: string;
  name: string;
  visibility: string;
  member_count: number;
  home_count: number;
};

export type Request = {
  request_id: string;
  name: string;
  note: string | null;
  requester: string;
  created_at: string;
};

export type Candidate = { profile_id: string; name: string; role: string };

/**
 * Everything about the community itself, in the order an admin needs it:
 * what is waiting on them, then what the place is called, then the pieces
 * inside it, then the one door marked "give this away".
 */
export function SettingsPanel({
  community,
  // Named childCommunities, not children: this is data, and calling it
  // `children` would collide with the slot every other component uses.
  childCommunities,
  requests,
  candidates,
  isOwner,
}: {
  community: Community;
  childCommunities: Child[];
  requests: Request[];
  candidates: Candidate[];
  isOwner: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [name, setName] = useState(community.name);
  const [description, setDescription] = useState(community.description ?? "");
  const [visibility, setVisibility] = useState(community.visibility);

  const [declining, setDeclining] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const [successor, setSuccessor] = useState("");
  const [confirmName, setConfirmName] = useState("");

  const successorName =
    candidates.find((c) => c.profile_id === successor)?.name ?? "";

  // Compared case-insensitively on purpose: the label above the field is
  // uppercased by the eyebrow style, so holding someone to the original
  // casing would fail them for typing exactly what the screen showed. The
  // point of the gate is deliberation, not transcription.
  const confirmed =
    successorName.length > 0 &&
    confirmName.trim().toLowerCase() === successorName.toLowerCase();

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
      setDeclining(null);
      setReason("");
      setConfirmName("");
      setSuccessor("");
      router.refresh();
    });
  }

  const dirty =
    name !== community.name ||
    description !== (community.description ?? "") ||
    visibility !== community.visibility;

  return (
    <>
      {error ? <Banner tone="bad">{error}</Banner> : null}
      {notice ? <Banner tone="good">{notice}</Banner> : null}

      {requests.length > 0 ? (
        <section className="mb-8">
          <h2 className="fp-eyebrow">
            {requests.length} neighbour{requests.length === 1 ? "" : "s"} asked to start a
            sub-community
          </h2>
          <div className="mt-3" style={{ display: "grid", gap: "var(--fp-space-2)" }}>
            {requests.map((r) => (
              <div key={r.request_id} className="fp-card px-4 py-4">
                <p style={{ fontFamily: "var(--fp-font-display)", fontSize: "var(--fp-text-lg)" }}>
                  {r.name}
                </p>
                <p style={{ fontSize: "var(--fp-text-sm)", color: "var(--fp-ink-3)", marginTop: 2 }}>
                  Asked by {r.requester}
                </p>
                {r.note ? (
                  <p
                    className="mt-3 rounded-xl px-3.5 py-2.5"
                    style={{
                      background: "var(--fp-surface-sunk)",
                      fontSize: "var(--fp-text-base)",
                      color: "var(--fp-ink-2)",
                    }}
                  >
                    “{r.note}”
                  </p>
                ) : null}

                {declining === r.request_id ? (
                  <div className="mt-3">
                    <label className="block">
                      <span className="fp-eyebrow">Why not</span>
                      <input
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="Willow Run already covers those homes."
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
                        onClick={() => setDeclining(null)}
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
                        onClick={() =>
                          run(() => decideCommunityRequest(r.request_id, false, reason))
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
                        Send the decline
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 flex gap-2">
                    <button
                      type="button"
                      onClick={() => setDeclining(r.request_id)}
                      className="fp-tap flex-1 rounded-xl"
                      style={{
                        border: "1px solid var(--fp-line)",
                        fontSize: "var(--fp-text-base)",
                        fontWeight: 500,
                      }}
                    >
                      Decline
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => run(() => decideCommunityRequest(r.request_id, true, ""))}
                      className="fp-tap flex-1 rounded-xl"
                      style={{
                        background: "var(--fp-forest)",
                        color: "var(--fp-ink-inverse)",
                        fontSize: "var(--fp-text-base)",
                        fontWeight: 600,
                      }}
                    >
                      Create it
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <SettingGroup
        title="This community"
        note="The name shows on every screen your neighbours see."
      >
        <label className="block py-4" style={{ borderBottom: "1px solid var(--fp-line)" }}>
          <span style={{ fontSize: "var(--fp-text-base)", fontWeight: 500 }}>Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-2 w-full rounded-xl px-3.5"
            style={{
              minHeight: 44,
              border: "1px solid var(--fp-line)",
              background: "var(--fp-surface)",
              fontSize: "var(--fp-text-base)",
            }}
          />
        </label>

        <label className="block py-4" style={{ borderBottom: "1px solid var(--fp-line)" }}>
          <span style={{ fontSize: "var(--fp-text-base)", fontWeight: 500 }}>Description</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="168 homes off Providence Road."
            className="mt-2 w-full rounded-xl px-3.5 py-2.5"
            style={{
              border: "1px solid var(--fp-line)",
              background: "var(--fp-surface)",
              fontSize: "var(--fp-text-base)",
              resize: "vertical",
            }}
          />
        </label>

        <SegmentedRow
          label="Who can find it"
          detail={
            visibility === "public"
              ? "Anyone signed in can find this community by name and ask to join. They still have to claim an address before they see anyone."
              : "Invite only. It does not appear in search, and the address list is not readable by anyone outside it."
          }
          value={visibility}
          options={[
            { value: "private" as const, label: "Invite only" },
            { value: "public" as const, label: "Public" },
          ]}
          onChange={setVisibility}
        />
      </SettingGroup>

      <button
        type="button"
        disabled={pending || !dirty}
        onClick={() =>
          run(() =>
            updateCommunity({
              communityId: community.id,
              name,
              description: description || null,
              visibility,
            }),
          )
        }
        className="fp-tap -mt-3 mb-8 flex w-full items-center justify-center rounded-xl"
        style={{
          background: "var(--fp-forest)",
          color: "var(--fp-ink-inverse)",
          fontSize: "var(--fp-text-base)",
          fontWeight: 600,
          opacity: pending || !dirty ? 0.4 : 1,
        }}
      >
        {dirty ? "Save changes" : "Saved"}
      </button>

      <section className="mb-8">
        <h2 className="fp-eyebrow">Inside this community</h2>
        <p
          style={{
            fontSize: "var(--fp-text-sm)",
            color: "var(--fp-ink-3)",
            marginTop: 4,
            maxWidth: "52ch",
          }}
        >
          A sub-community has its own map, directory and local admin. Your role reaches
          down into every one of them; theirs does not reach back up.
        </p>
        <div className="mt-3" style={{ display: "grid", gap: "var(--fp-space-2)" }}>
          {childCommunities.length === 0 ? (
            <p style={{ fontSize: "var(--fp-text-base)", color: "var(--fp-ink-3)" }}>
              No sub-communities yet.
            </p>
          ) : null}
          {childCommunities.map((c) => (
            <div key={c.id} className="fp-card flex items-center gap-3 px-4 py-3.5">
              <span
                className="inline-flex shrink-0 items-center justify-center rounded-full"
                style={{
                  width: 38,
                  height: 38,
                  background: "var(--fp-forest-wash)",
                  color: "var(--fp-forest)",
                }}
              >
                <Icon name="home" size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <p style={{ fontSize: "var(--fp-text-base)", fontWeight: 500 }}>{c.name}</p>
                <p style={{ fontSize: "var(--fp-text-sm)", color: "var(--fp-ink-3)" }}>
                  {c.member_count} {c.member_count === 1 ? "neighbour" : "neighbours"} ·{" "}
                  {c.home_count} {c.home_count === 1 ? "home" : "homes"} ·{" "}
                  {c.visibility === "public" ? "Public" : "Invite only"}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {isOwner ? (
        <section
          className="rounded-2xl px-4 py-4"
          style={{ border: "1px solid var(--fp-rejected)" }}
        >
          <h2 className="fp-eyebrow" style={{ color: "var(--fp-rejected)" }}>
            Hand this community over
          </h2>
          <p
            style={{
              fontSize: "var(--fp-text-sm)",
              color: "var(--fp-ink-2)",
              marginTop: 6,
              maxWidth: "52ch",
            }}
          >
            You become an admin and they become the owner. Only they can hand it back, so
            this is not something you can undo on your own.
          </p>

          <label className="mt-4 block">
            <span className="fp-eyebrow">Who takes over</span>
            <select
              value={successor}
              onChange={(e) => {
                setSuccessor(e.target.value);
                setConfirmName("");
              }}
              className="mt-1.5 w-full rounded-xl px-3"
              style={{
                minHeight: 44,
                border: "1px solid var(--fp-line)",
                background: "var(--fp-surface)",
                fontSize: "var(--fp-text-base)",
              }}
            >
              <option value="">Choose a member…</option>
              {candidates.map((c) => (
                <option key={c.profile_id} value={c.profile_id}>
                  {c.name} — {c.role}
                </option>
              ))}
            </select>
          </label>

          {successor ? (
            <>
              <label className="mt-3 block">
                <span className="fp-eyebrow">Type “{successorName}” to confirm</span>
                <input
                  value={confirmName}
                  onChange={(e) => setConfirmName(e.target.value)}
                  className="mt-1.5 w-full rounded-xl px-3.5"
                  style={{
                    minHeight: 44,
                    border: "1px solid var(--fp-line)",
                    background: "var(--fp-surface)",
                    fontSize: "var(--fp-text-base)",
                  }}
                />
              </label>
              <button
                type="button"
                disabled={pending || !confirmed}
                onClick={() => run(() => transferOwnership(community.id, successor))}
                className="fp-tap mt-3 flex w-full items-center justify-center rounded-xl"
                style={{
                  background: "var(--fp-rejected)",
                  color: "var(--fp-ink-inverse)",
                  fontSize: "var(--fp-text-base)",
                  fontWeight: 600,
                  opacity: pending || !confirmed ? 0.45 : 1,
                }}
              >
                Hand {community.name} to {successorName}
              </button>
            </>
          ) : null}
        </section>
      ) : null}
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
