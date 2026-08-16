"use client";

import { useEffect, useRef } from "react";
import { AvatarPair } from "@/components/ui/Avatar";
import { ActionButton } from "@/components/ui/Controls";
import { LimitedNotice } from "@/components/ui/BottomSheet";
import { ServiceTag } from "@/components/ui/ServiceTag";
import { householdTitle } from "@/lib/utils";
import type { HouseholdCard as Card, ServiceCategory } from "@/lib/types";

/**
 * The household detail shown in the bottom sheet — Figma screen 2.
 *
 * Every contact decision here is read from the payload, never inferred. If
 * `phone.value` is null the number was withheld by the database and there is
 * nothing to reveal; if `can_call` is false the owner allowed texting only,
 * so the Call button is present but inert with a reason. The component never
 * asks "is this person an admin" — the answer would be irrelevant, because
 * the redaction already happened server-side.
 */
export function HouseholdCard({
  card,
  categories,
  highlightProfileId = null,
}: {
  card: Card;
  categories: ServiceCategory[];
  /**
   * Set when the card was opened by searching for one particular person.
   * Four names under one address is the right answer to "who lives here" and
   * the wrong answer to "where is Aaron", so the person asked for is marked
   * and scrolled to rather than left for the reader to find again.
   */
  highlightProfileId?: string | null;
}) {
  const names = card.members.map((m) => m.name);
  const highlightRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (!highlightProfileId) return;
    highlightRef.current?.scrollIntoView({ block: "nearest" });
  }, [highlightProfileId, card.id]);
  const primary = card.members.find((m) => m.is_primary) ?? card.members[0];

  const phone = primary?.phone;
  const email = primary?.email ?? null;

  const since = card.members
    .map((m) => m.resident_since)
    .filter(Boolean)
    .sort()[0];

  const catFor = (slug: string) => categories.find((c) => c.slug === slug);

  const mapsHref = card.geo
    ? `https://www.google.com/maps/dir/?api=1&destination=${card.geo.coordinates[1]},${card.geo.coordinates[0]}`
    : undefined;

  return (
    <div>
      <h2 style={{ fontSize: "var(--fp-text-xl)" }}>
        {card.address}
        {card.unit ? `, ${card.unit}` : ""}
      </h2>
      <p style={{ fontSize: "var(--fp-text-sm)", color: "var(--fp-ink-3)", marginTop: 4 }}>
        {card.city}, {card.state} {card.postal_code}
      </p>

      {card.members.length === 0 ? (
        <LimitedNotice className="mt-5" />
      ) : (
        <>
          <div className="mt-5 flex items-center gap-3.5">
            <AvatarPair names={names} size={46} />
            <div className="min-w-0">
              <p
                style={{
                  fontFamily: "var(--fp-font-display)",
                  fontSize: "var(--fp-text-md)",
                  fontWeight: 600,
                }}
              >
                {householdTitle(names)}
              </p>
              {since ? (
                <p style={{ fontSize: "var(--fp-text-sm)", color: "var(--fp-ink-3)" }}>
                  {card.members.length > 1 ? "Residents" : "Resident"} since{" "}
                  {new Date(since).getFullYear()}
                </p>
              ) : null}
            </div>
          </div>

          <div className="mt-6 flex justify-between gap-2">
            <ActionButton
              label="Call"
              icon="phone"
              href={phone?.can_call && phone.value ? `tel:${phone.value}` : undefined}
              disabled={!phone?.can_call || !phone.value}
              disabledReason={
                phone?.can_text
                  ? "This neighbour prefers text messages."
                  : "This neighbour has not shared a phone number."
              }
            />
            <ActionButton
              label="Text"
              icon="message"
              href={phone?.can_text && phone.value ? `sms:${phone.value}` : undefined}
              disabled={!phone?.can_text || !phone.value}
              disabledReason="This neighbour has not shared a phone number."
            />
            <ActionButton
              label="Directions"
              icon="directions"
              href={mapsHref}
              disabled={!mapsHref}
              disabledReason="This home has no map location yet."
            />
            <ActionButton
              label="Email"
              icon="mail"
              href={email ? `mailto:${email}` : undefined}
              disabled={!email}
              disabledReason="This neighbour has hidden their email address."
            />
          </div>
        </>
      )}

      {card.services.length > 0 ? (
        <div className="mt-6 flex flex-wrap gap-2">
          {card.services.map((s) => {
            const cat = catFor(s.category);
            return (
              <ServiceTag
                key={s.id}
                label={cat?.label ?? s.category}
                icon={cat?.icon}
                accent={cat?.accent ?? "forest"}
              />
            );
          })}
        </div>
      ) : null}

      {card.members.length > 1 ? (
        <div className="mt-6">
          <h3
            className="fp-eyebrow"
            style={{ paddingBottom: 8, borderBottom: "1px solid var(--fp-line-soft)" }}
          >
            Household
          </h3>
          <ul className="mt-2">
            {card.members.map((m) => {
              const isMatch = m.profile_id === highlightProfileId;
              return (
                <li
                  key={m.profile_id}
                  ref={isMatch ? highlightRef : undefined}
                  aria-current={isMatch ? "true" : undefined}
                  className="flex items-center justify-between py-2"
                  style={{
                    fontSize: "var(--fp-text-base)",
                    ...(isMatch
                      ? {
                          background: "var(--fp-forest-wash)",
                          // Indented rather than boxed: a full border around
                          // one row of a list reads as a separate card.
                          boxShadow: "inset 3px 0 0 var(--fp-forest)",
                          borderRadius: "var(--fp-radius-sm)",
                          paddingLeft: 12,
                          paddingRight: 12,
                          marginInline: -12,
                        }
                      : null),
                  }}
                >
                  <span style={{ fontWeight: isMatch ? 600 : undefined }}>
                    {m.name}
                    {isMatch ? (
                      <span className="fp-sr-only"> — matches your search</span>
                    ) : null}
                  </span>
                  <span style={{ fontSize: "var(--fp-text-sm)", color: "var(--fp-ink-3)" }}>
                    {m.relationship === "owner" ? "Owner" : m.relationship === "renter" ? "Renter" : "Household"}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
