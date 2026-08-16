"use client";

import { useOptimistic, useState, useTransition } from "react";
import { SegmentedRow, SettingGroup, SwitchRow } from "@/components/ui/SettingRow";
import { updateListing, updatePrivacy, type PrivacyPatch } from "./actions";

type Result = { ok: boolean; error?: string };

type Settings = {
  phone_vis: "hidden" | "text_only" | "call_and_text";
  email_vis: "hidden" | "visible";
  show_on_map: boolean;
  show_in_directory: boolean;
  is_listed: boolean;
};

/**
 * The privacy screen.
 *
 * Each control writes immediately and shows the new state before the server
 * answers. If the write fails the value snaps back and an error appears —
 * which is the honest behaviour for a setting whose whole job is to be true.
 */
export function PrivacyPanel({
  initial,
  hasHousehold,
}: {
  initial: Settings;
  hasHousehold: boolean;
}) {
  const [saved, setSaved] = useState<Settings>(initial);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [shown, setShown] = useOptimistic(saved, (_prev, next: Settings) => next);

  function apply(next: Partial<Settings>) {
    const merged = { ...saved, ...next };
    setError(null);
    setTouched(true);
    startTransition(async () => {
      setShown(merged);
      const { is_listed, ...privacy } = next;
      const results = await Promise.all([
        Object.keys(privacy).length
          ? updatePrivacy(privacy as PrivacyPatch)
          : Promise.resolve({ ok: true } as Result),
        is_listed === undefined
          ? Promise.resolve({ ok: true } as Result)
          : updateListing(is_listed),
      ]);
      const failure = results.find((r) => !r.ok);
      if (failure) {
        setError(failure.error ?? "That change did not save.");
        return;
      }
      setSaved(merged);
    });
  }

  return (
    <>
      {error ? (
        <p
          role="alert"
          className="mb-5 rounded-xl px-4 py-3"
          style={{
            background: "var(--fp-rejected-wash)",
            color: "var(--fp-rejected)",
            fontSize: "var(--fp-text-base)",
          }}
        >
          {error}
        </p>
      ) : null}

      <SettingGroup
        title="How neighbours reach you"
        note="Your number is never shown to anyone outside this community, and never to someone whose address has not been confirmed."
      >
        <SegmentedRow
          label="Phone"
          detail={
            shown.phone_vis === "hidden"
              ? "Neighbours see no number and no Call or Text button."
              : shown.phone_vis === "text_only"
                ? "Neighbours can text you. The Call button stays greyed out."
                : "Neighbours can call or text you."
          }
          value={shown.phone_vis}
          options={[
            { value: "hidden", label: "Hidden" },
            { value: "text_only", label: "Text only" },
            { value: "call_and_text", label: "Call & text" },
          ]}
          onChange={(phone_vis) => apply({ phone_vis })}
        />
        <SwitchRow
          label="Show my email"
          detail="Off by default. Most neighbours never need it."
          checked={shown.email_vis === "visible"}
          onChange={(on) => apply({ email_vis: on ? "visible" : "hidden" })}
        />
      </SettingGroup>

      <SettingGroup
        title="Where you appear"
        note="This is a public-facing address book for the people who live here. These three switches decide how much of it is about you."
      >
        <SwitchRow
          label="Show my home on the map"
          detail="Off removes the pin entirely — unless someone else in your household still wants theirs."
          checked={shown.show_on_map}
          onChange={(show_on_map) => apply({ show_on_map })}
        />
        <SwitchRow
          label="List me in the directory"
          detail="Off hides your name from search and from every household card, including your own."
          checked={shown.show_in_directory}
          onChange={(show_in_directory) => apply({ show_in_directory })}
        />
        <SwitchRow
          label="Name me on my household"
          detail={
            hasHousehold
              ? "Off keeps the home on the map but leaves you off the list of who lives there."
              : "Available once an admin confirms your address."
          }
          checked={shown.is_listed}
          disabled={!hasHousehold}
          onChange={(is_listed) => apply({ is_listed })}
        />
      </SettingGroup>

      <p
        aria-live="polite"
        style={{
          fontSize: "var(--fp-text-sm)",
          color: pending ? "var(--fp-ink-3)" : "var(--fp-verified)",
          minHeight: 20,
        }}
      >
        {pending ? "Saving…" : error || !touched ? "" : "Saved"}
      </p>
    </>
  );
}
