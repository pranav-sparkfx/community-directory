"use client";

import { useEffect, useMemo, useState } from "react";
import { BottomSheet, type SheetState } from "@/components/ui/BottomSheet";
import { FilterChip, SearchField } from "@/components/ui/Controls";
import { HouseholdCard } from "@/components/directory/HouseholdCard";
import { MapCanvas } from "@/components/map/MapCanvas";
import { ResidentRow } from "@/components/directory/ResidentRow";
import { createClient } from "@/lib/supabase/client";
import { rankByMatch } from "@/lib/search";
import type {
  Community,
  HouseholdCard as Card,
  HouseholdCollection,
  HouseholdFeature,
  ServiceCategory,
} from "@/lib/types";

/**
 * Figma screens 1 and 2: Home — Browsing, and Home — Household selected.
 *
 * Search filters the pin source rather than navigating away, so the map and
 * the list stay the same view of the same data. Selection lives in component
 * state here; Phase 3 lifts it into the URL so a household is shareable.
 */
export function HomeView({
  community,
  initialData,
  categories,
  newResidentCount,
}: {
  community: Community;
  initialData: HouseholdCollection;
  categories: ServiceCategory[];
  newResidentCount: number;
}) {
  const [query, setQuery] = useState("");
  const [servicesOnly, setServicesOnly] = useState(false);
  const [selected, setSelected] = useState<HouseholdFeature | null>(null);
  const [card, setCard] = useState<Card | null>(null);
  const [sheet, setSheet] = useState<SheetState>("peek");

  // Ranked rather than a substring test, so the closest home comes first and
  // an out-of-order or slightly mistyped query still finds the street. The
  // list below renders in this order; the map reads the same collection, so
  // both views agree on what matched.
  //
  // KNOWN GAP: the placeholder offers name and service search, but a pin
  // carries neither — visible_households() returns address, unit, kind and a
  // count, and that is deliberate, because names are governed by is_listed and
  // show_in_directory and belong behind household_card()'s redaction. Making
  // them searchable needs a server-side RPC that applies the same rules, not a
  // wider pin payload.
  const filtered: HouseholdCollection = useMemo(() => {
    const withinFilter = servicesOnly
      ? initialData.features.filter((f) => f.properties.kind === "service")
      : initialData.features;

    return {
      type: "FeatureCollection",
      features: rankByMatch(withinFilter, query, (f) => [
        f.properties.address,
        f.properties.unit,
      ]),
    };
  }, [initialData, query, servicesOnly]);

  // Fetch the card through the RPC rather than reusing the pin properties:
  // pins deliberately carry no contact data, and household_card() is where
  // redaction happens.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!selected) {
        if (!cancelled) setCard(null);
        return;
      }
      const supabase = createClient();
      const { data } = await supabase.rpc("household_card", {
        target_household: selected.properties.id,
      });
      if (!cancelled) setCard((data as Card) ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [selected]);

  // Falls back to the Summerlake centroid when a community has no centre
  // set — a new community exists before an admin has framed its map.
  const center: [number, number] =
    community.center_lng != null && community.center_lat != null
      ? [community.center_lng, community.center_lat]
      : [-80.8431, 35.2271];

  const searching = query.trim().length > 0 || servicesOnly;

  return (
    <div className="fixed inset-0" style={{ background: "var(--fp-map-base)" }}>
      <MapCanvas
        className="absolute inset-0"
        data={filtered}
        center={center}
        zoom={community.default_zoom}
        selectedId={selected?.properties.id ?? null}
        onSelect={(f) => {
          setSelected(f);
          setSheet(f ? "half" : "peek");
        }}
      />

      {/* Map overlay: search + filter chips */}
      <div
        className="absolute inset-x-0 top-0 z-10 flex flex-col gap-2.5 px-4 pb-3"
        style={{ paddingTop: `calc(env(safe-area-inset-top) + var(--fp-space-3))` }}
      >
        <SearchField value={query} onChange={setQuery} />
        <div className="flex gap-2">
          <FilterChip
            label="Find Help"
            icon="people"
            active={servicesOnly}
            onClick={() => setServicesOnly((v) => !v)}
          />
          <FilterChip label="New Residents" icon="home" count={newResidentCount} />
        </div>
      </div>

      <BottomSheet
        state={sheet}
        onStateChange={setSheet}
        ariaLabel={card ? `Details for ${card.address}` : `${community.name} directory`}
        peekContent={
          <div className="flex items-baseline justify-between gap-3">
            <div className="min-w-0">
              <h2 style={{ fontSize: "var(--fp-text-xl)" }}>
                {card ? card.address : community.name}
              </h2>
              <p style={{ fontSize: "var(--fp-text-sm)", color: "var(--fp-ink-3)" }}>
                {card
                  ? "Tap to see who lives here"
                  : `${initialData.features.length} homes · ${newResidentCount} new neighbours this month`}
              </p>
            </div>
          </div>
        }
      >
        {card ? (
          <HouseholdCard card={card} categories={categories} />
        ) : (
          <>
            <h2 style={{ fontSize: "var(--fp-text-xl)" }}>
              {searching ? "Matching homes" : community.name}
            </h2>
            <p style={{ fontSize: "var(--fp-text-sm)", color: "var(--fp-ink-3)", marginTop: 4 }}>
              {filtered.features.length}{" "}
              {filtered.features.length === 1 ? "home" : "homes"}
              {searching ? " match your search" : " on the map"}
            </p>

            {filtered.features.length === 0 ? (
              <p
                style={{
                  fontSize: "var(--fp-text-base)",
                  color: "var(--fp-ink-2)",
                  marginTop: "var(--fp-space-6)",
                }}
              >
                No homes match “{query}”. Try a street name, or clear the filters.
              </p>
            ) : (
              <div className="mt-4">
                {filtered.features.slice(0, 60).map((f) => (
                  <button
                    key={f.properties.id}
                    type="button"
                    onClick={() => {
                      setSelected(f);
                      setSheet("half");
                    }}
                    className="block w-full text-left"
                    style={{ borderBottom: "1px solid var(--fp-line-soft)" }}
                  >
                    <ResidentRow
                      address={f.properties.address}
                      names={[]}
                      meta={
                        f.properties.resident_count > 0
                          ? `${f.properties.resident_count} listed`
                          : "No listed residents"
                      }
                    />
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </BottomSheet>
    </div>
  );
}
