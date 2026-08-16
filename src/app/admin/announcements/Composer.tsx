"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Icon } from "@/components/ui/Icon";
import { shortDate } from "@/lib/utils";
import {
  deleteAnnouncement,
  deleteEvent,
  postAnnouncement,
  postEvent,
  setPinned,
} from "./actions";

export type Notice = {
  id: string;
  kind: string;
  title: string;
  body: string;
  pinned: boolean;
  publish_at: string;
};

export type Ev = {
  id: string;
  title: string;
  location: string | null;
  starts_at: string;
};

const field: React.CSSProperties = {
  minHeight: 44,
  border: "1px solid var(--fp-line)",
  background: "var(--fp-surface)",
  fontSize: "var(--fp-text-base)",
};

/**
 * Telling the neighbourhood something.
 *
 * Announcements and events share this screen because from an admin's side
 * they are one job with two shapes. They are NOT collapsed into one form:
 * an event has a time and a place and belongs on a calendar, and pretending
 * otherwise would mean a date picker sitting unused above every notice.
 */
export function Composer({
  notices,
  events,
  canPostOfficial,
}: {
  notices: Notice[];
  events: Ev[];
  canPostOfficial: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [mode, setMode] = useState<"notice" | "event">("notice");
  const [kind, setKind] = useState(canPostOfficial ? "hoa" : "neighbor");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [pinned, setPinnedState] = useState(false);
  const [location, setLocation] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

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
      setConfirmDelete(null);
      router.refresh();
    });
  }

  function submit() {
    run(async () => {
      const r =
        mode === "notice"
          ? await postAnnouncement({ kind, title, body, pinned })
          : await postEvent({
              title,
              body,
              location: location || undefined,
              startsAt,
              endsAt: endsAt || undefined,
            });
      if (r.ok) {
        setTitle("");
        setBody("");
        setLocation("");
        setStartsAt("");
        setEndsAt("");
        setPinnedState(false);
      }
      return r;
    });
  }

  const ready =
    title.trim().length >= 4 && (mode === "notice" || startsAt.length > 0);

  return (
    <>
      {error ? <Banner tone="bad">{error}</Banner> : null}
      {notice ? <Banner tone="good">{notice}</Banner> : null}

      <section className="mb-9">
        <div
          role="radiogroup"
          aria-label="What are you posting"
          className="flex gap-1 rounded-xl p-1"
          style={{ background: "var(--fp-surface-sunk)" }}
        >
          {(
            [
              { v: "notice" as const, label: "Announcement" },
              { v: "event" as const, label: "Event" },
            ]
          ).map((o) => {
            const active = mode === o.v;
            return (
              <button
                key={o.v}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setMode(o.v)}
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
                {o.label}
              </button>
            );
          })}
        </div>

        <div className="fp-card mt-3 px-4 py-4">
          <label className="block">
            <span className="fp-eyebrow">
              {mode === "notice" ? "Headline" : "What is happening"}
            </span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={
                mode === "notice"
                  ? "Water shut-off Tuesday, 9am to noon"
                  : "Block party on Flintgrove Loop"
              }
              className="mt-1.5 w-full rounded-xl px-3.5"
              style={field}
            />
          </label>

          {mode === "event" ? (
            <>
              <label className="mt-3 block">
                <span className="fp-eyebrow">Where</span>
                <input
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="The pond pavilion"
                  className="mt-1.5 w-full rounded-xl px-3.5"
                  style={field}
                />
              </label>
              <div className="mt-3 flex gap-2">
                <label className="min-w-0 flex-1">
                  <span className="fp-eyebrow">Starts</span>
                  <input
                    type="datetime-local"
                    value={startsAt}
                    onChange={(e) => setStartsAt(e.target.value)}
                    className="mt-1.5 w-full rounded-xl px-3"
                    style={field}
                  />
                </label>
                <label className="min-w-0 flex-1">
                  <span className="fp-eyebrow">Ends</span>
                  <input
                    type="datetime-local"
                    value={endsAt}
                    onChange={(e) => setEndsAt(e.target.value)}
                    className="mt-1.5 w-full rounded-xl px-3"
                    style={field}
                  />
                </label>
              </div>
            </>
          ) : null}

          <label className="mt-3 block">
            <span className="fp-eyebrow">Details</span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              placeholder={
                mode === "notice"
                  ? "Crews will be working on the main by the pond. Fill a jug the night before."
                  : "Potluck — bring a dish to share. Road closed to through traffic from 4pm."
              }
              className="mt-1.5 w-full rounded-xl px-3.5 py-2.5"
              style={{ ...field, minHeight: 0, resize: "vertical" }}
            />
          </label>

          {mode === "notice" ? (
            <>
              {canPostOfficial ? (
                <div
                  role="radiogroup"
                  aria-label="Whose voice"
                  className="mt-4 flex gap-1 rounded-xl p-1"
                  style={{ background: "var(--fp-surface-sunk)" }}
                >
                  {[
                    { v: "hoa", label: "From the association" },
                    { v: "neighbor", label: "From you" },
                  ].map((o) => {
                    const active = kind === o.v;
                    return (
                      <button
                        key={o.v}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => setKind(o.v)}
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
                        {o.label}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p
                  style={{
                    fontSize: "var(--fp-text-sm)",
                    color: "var(--fp-ink-3)",
                    marginTop: 12,
                  }}
                >
                  This posts under your own name. Only an admin can post in the
                  association&rsquo;s name.
                </p>
              )}

              <label className="mt-4 flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={pinned}
                  onChange={(e) => setPinnedState(e.target.checked)}
                  style={{ marginTop: 3, width: 20, height: 20, accentColor: "var(--fp-forest)" }}
                />
                <span className="min-w-0">
                  <span className="block" style={{ fontSize: "var(--fp-text-base)", fontWeight: 500 }}>
                    Pin to the top
                  </span>
                  <span className="block" style={{ fontSize: "var(--fp-text-sm)", color: "var(--fp-ink-3)" }}>
                    For things that stay true for a while — pool hours, a closure.
                  </span>
                </span>
              </label>
            </>
          ) : null}

          <button
            type="button"
            disabled={pending || !ready}
            onClick={submit}
            className="fp-tap mt-5 flex w-full items-center justify-center gap-2 rounded-xl"
            style={{
              background: "var(--fp-forest)",
              color: "var(--fp-ink-inverse)",
              fontSize: "var(--fp-text-base)",
              fontWeight: 600,
              opacity: pending || !ready ? 0.45 : 1,
            }}
          >
            <Icon name="announcements" size={18} strokeWidth={1.9} />
            {pending
              ? "Sending…"
              : mode === "notice"
                ? "Post to the neighbourhood"
                : "Add to the calendar"}
          </button>

          {mode === "notice" ? (
            <p
              style={{
                fontSize: "var(--fp-text-sm)",
                color: "var(--fp-ink-3)",
                marginTop: 10,
                textAlign: "center",
              }}
            >
              Everyone whose address is confirmed gets this in their inbox.
            </p>
          ) : null}
        </div>
      </section>

      <Section title="Posted">
        {notices.length === 0 ? <Muted>Nothing posted yet.</Muted> : null}
        {notices.map((n) => (
          <div key={n.id} className="fp-card px-4 py-3.5">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p style={{ fontSize: "var(--fp-text-base)", fontWeight: 500 }}>{n.title}</p>
                <p style={{ fontSize: "var(--fp-text-sm)", color: "var(--fp-ink-3)", marginTop: 2 }}>
                  {n.kind === "hoa" ? "From the association" : "From a neighbour"} ·{" "}
                  {shortDate(n.publish_at)}
                  {n.pinned ? " · Pinned" : ""}
                </p>
              </div>
              <div className="flex shrink-0 gap-1.5">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => setPinned(n.id, !n.pinned))}
                  className="fp-tap rounded-full px-3"
                  style={{
                    border: "1px solid var(--fp-line)",
                    background: n.pinned ? "var(--fp-surface-sunk)" : "transparent",
                    fontSize: "var(--fp-text-sm)",
                    minHeight: 36,
                  }}
                >
                  {n.pinned ? "Unpin" : "Pin"}
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    confirmDelete === n.id
                      ? run(() => deleteAnnouncement(n.id))
                      : setConfirmDelete(n.id)
                  }
                  className="fp-tap rounded-full px-3"
                  style={{
                    border: `1px solid ${confirmDelete === n.id ? "var(--fp-rejected)" : "var(--fp-line)"}`,
                    background: confirmDelete === n.id ? "var(--fp-rejected)" : "transparent",
                    color:
                      confirmDelete === n.id ? "var(--fp-ink-inverse)" : "var(--fp-rejected)",
                    fontSize: "var(--fp-text-sm)",
                    minHeight: 36,
                  }}
                >
                  {confirmDelete === n.id ? "Really?" : "Delete"}
                </button>
              </div>
            </div>
          </div>
        ))}
      </Section>

      <Section title="On the calendar">
        {events.length === 0 ? <Muted>No upcoming events.</Muted> : null}
        {events.map((e) => (
          <div key={e.id} className="fp-card flex items-start gap-3 px-4 py-3.5">
            <div className="min-w-0 flex-1">
              <p style={{ fontSize: "var(--fp-text-base)", fontWeight: 500 }}>{e.title}</p>
              <p style={{ fontSize: "var(--fp-text-sm)", color: "var(--fp-ink-3)", marginTop: 2 }}>
                {shortDate(e.starts_at)}
                {e.location ? ` · ${e.location}` : ""}
              </p>
            </div>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                confirmDelete === e.id ? run(() => deleteEvent(e.id)) : setConfirmDelete(e.id)
              }
              className="fp-tap shrink-0 rounded-full px-3"
              style={{
                border: `1px solid ${confirmDelete === e.id ? "var(--fp-rejected)" : "var(--fp-line)"}`,
                background: confirmDelete === e.id ? "var(--fp-rejected)" : "transparent",
                color: confirmDelete === e.id ? "var(--fp-ink-inverse)" : "var(--fp-rejected)",
                fontSize: "var(--fp-text-sm)",
                minHeight: 36,
              }}
            >
              {confirmDelete === e.id ? "Really?" : "Remove"}
            </button>
          </div>
        ))}
      </Section>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="fp-eyebrow">{title}</h2>
      <div className="mt-3" style={{ display: "grid", gap: "var(--fp-space-2)" }}>
        {children}
      </div>
    </section>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontSize: "var(--fp-text-base)", color: "var(--fp-ink-3)" }}>{children}</p>
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
