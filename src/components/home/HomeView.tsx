"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BottomSheet, type SheetState } from "@/components/ui/BottomSheet";
import { FilterChip, SearchField } from "@/components/ui/Controls";
import { HouseholdCard } from "@/components/directory/HouseholdCard";
import { MapCanvas } from "@/components/map/MapCanvas";
import { ResidentRow } from "@/components/directory/ResidentRow";
import { SearchOverlay } from "@/components/home/SearchOverlay";
import { createClient } from "@/lib/supabase/client";
import { rankByMatch, rankByNamePrefix } from "@/lib/search";
import type {
  Community,
  HouseholdCard as Card,
  HouseholdCollection,
  HouseholdFeature,
  MapFocus,
  SearchPerson,
  SearchResult,
  ServiceCategory,
} from "@/lib/types";

/** Per group, so one very common surname cannot bury every address. */
const MAX_PER_GROUP = 8;

const LISTBOX_ID = "fp-search-results";
const optionId = (index: number) => `fp-search-option-${index}`;

/**
 * Figma screens 1 and 2: Home — Browsing, and Home — Household selected.
 *
 * Search is an overlay over the map rather than a filter of it. That is a
 * correctness decision before it is a design one. Names and addresses are two
 * different indexes over the same homes, so a query that finds Aaron Diaz has
 * no reason to match "2600 Flintgrove Loop" — and the old behaviour, which
 * deleted every non-matching pin as you typed, would have removed his pin from
 * the map a keystroke before you clicked his name. Picking a result would have
 * flown to a home that was no longer drawn.
 *
 * So the map keeps every pin and holds still while you type; the overlay is
 * the only surface that answers the query, and picking from it is what moves
 * the camera. The "Find Help" chip still filters, because that is a filter.
 */
export function HomeView({
  community,
  initialData,
  people,
  categories,
  newResidentCount,
}: {
  community: Community;
  initialData: HouseholdCollection;
  people: SearchPerson[];
  categories: ServiceCategory[];
  newResidentCount: number;
}) {
  const [query, setQuery] = useState("");
  const [servicesOnly, setServicesOnly] = useState(false);
  const [selected, setSelected] = useState<HouseholdFeature | null>(null);
  const [highlightProfileId, setHighlightProfileId] = useState<string | null>(null);
  const [card, setCard] = useState<Card | null>(null);
  const [sheet, setSheet] = useState<SheetState>("peek");
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const [isOverlayOpen, setOverlayOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  // Only the chip filters the map now. The query deliberately does not.
  const filtered: HouseholdCollection = useMemo(
    () => ({
      type: "FeatureCollection",
      features: servicesOnly
        ? initialData.features.filter((f) => f.properties.kind === "service")
        : initialData.features,
    }),
    [initialData, servicesOnly],
  );

  // Pins carry no geometry lookup of their own, so a person is joined back to
  // their home here. search_index() already guarantees the household is mapped
  // and has coordinates, but a person whose feature is somehow absent is
  // dropped rather than offered: a row that cannot fly anywhere is worse than
  // no row.
  const featureById = useMemo(() => {
    const map = new Map<string, HouseholdFeature>();
    for (const f of initialData.features) map.set(f.properties.id, f);
    return map;
  }, [initialData]);

  const results: SearchResult[] = useMemo(() => {
    if (query.trim().length === 0) return [];

    const matchedPeople = rankByNamePrefix(people, query, (p) => p.name)
      .flatMap<SearchResult>((person) => {
        const feature = featureById.get(person.household_id);
        return feature
          ? [{ kind: "person", id: `person:${person.profile_id}`, person, feature }]
          : [];
      })
      .slice(0, MAX_PER_GROUP);

    const matchedHomes = rankByMatch(initialData.features, query, (f) => [
      f.properties.address,
      f.properties.unit,
    ])
      .slice(0, MAX_PER_GROUP)
      .map<SearchResult>((feature) => ({
        kind: "household",
        id: `home:${feature.properties.id}`,
        feature,
      }));

    return [...matchedPeople, ...matchedHomes];
  }, [query, people, initialData, featureById]);

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

  const showOverlay = isOverlayOpen && query.trim().length > 0;

  /**
   * How far above the container centre the pin has to sit to clear the sheet.
   *
   * The map fills the viewport, so its centre is at half the height; the
   * usable strip is whatever the half-open sheet and the tab bar leave above
   * them. Centring the pin in that strip is the difference between landing on
   * the home and landing on the sheet that is covering it.
   */
  const sheetOffset = useCallback((): [number, number] => {
    if (typeof window === "undefined") return [0, 0];
    const viewport = window.innerHeight;
    const TAB_BAR = 56; // --fp-tabbar-h
    const SHEET_HALF = 0.46; // --fp-sheet-half
    const visibleBand = viewport - (viewport * SHEET_HALF + TAB_BAR);
    return [0, Math.round(visibleBand / 2 - viewport / 2)];
  }, []);

  const openHousehold = useCallback(
    (feature: HouseholdFeature, profileId: string | null) => {
      setSelected(feature);
      setHighlightProfileId(profileId);
      setSheet("half");
      setOverlayOpen(false);
      setActiveIndex(-1);
      setFocus({
        center: feature.geometry.coordinates,
        offset: sheetOffset(),
      });
      inputRef.current?.blur();
    },
    [sheetOffset],
  );

  const pick = useCallback(
    (result: SearchResult) => {
      openHousehold(
        result.feature,
        result.kind === "person" ? result.person.profile_id : null,
      );
    },
    [openHousehold],
  );

  const onSearchKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        setOverlayOpen(false);
        setActiveIndex(-1);
        return;
      }
      if (!showOverlay || results.length === 0) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % results.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => (i <= 0 ? results.length - 1 : i - 1));
      } else if (e.key === "Enter") {
        // With nothing highlighted, Enter takes the top result — the same
        // bargain every search box makes, and the reason typing a full name
        // and hitting return works without ever touching the arrow keys.
        const target = results[activeIndex] ?? results[0];
        if (target) {
          e.preventDefault();
          pick(target);
        }
      }
    },
    [showOverlay, results, activeIndex, pick],
  );

  // Falls back to the Summerlake centroid when a community has no centre
  // set — a new community exists before an admin has framed its map.
  const center: [number, number] =
    community.center_lng != null && community.center_lat != null
      ? [community.center_lng, community.center_lat]
      : [-80.8431, 35.2271];

  return (
    <div className="fixed inset-0" style={{ background: "var(--fp-map-base)" }}>
      <MapCanvas
        className="absolute inset-0"
        data={filtered}
        center={center}
        zoom={community.default_zoom}
        selectedId={selected?.properties.id ?? null}
        focus={focus}
        onSelect={(f) => {
          setSelected(f);
          setHighlightProfileId(null);
          setSheet(f ? "half" : "peek");
          setOverlayOpen(false);
        }}
      />

      {/* Map overlay: search + filter chips */}
      <div
        className="absolute inset-x-0 top-0 z-10 flex flex-col gap-2.5 px-4 pb-3"
        style={{ paddingTop: `calc(env(safe-area-inset-top) + var(--fp-space-3))` }}
      >
        {/* Positioned so the results panel floats over the chips rather than
            shoving them down the screen as you type. */}
        <div className="relative">
          <SearchField
            value={query}
            onChange={(v) => {
              setQuery(v);
              setOverlayOpen(true);
              // Any edit invalidates the highlighted row — the list under it
              // is a different list now. Done here rather than in an effect
              // watching `query`, which would be a second render to undo
              // state the first render had no business setting.
              setActiveIndex(-1);
            }}
            onFocus={() => setOverlayOpen(true)}
            onKeyDown={onSearchKeyDown}
            onClear={() => {
              setQuery("");
              setOverlayOpen(false);
              inputRef.current?.focus();
            }}
            inputRef={inputRef}
            listboxId={LISTBOX_ID}
            isExpanded={showOverlay && results.length > 0}
            activeOptionId={activeIndex >= 0 ? optionId(activeIndex) : undefined}
          />

          {showOverlay ? (
            <SearchOverlay
              results={results}
              query={query}
              activeIndex={activeIndex}
              listboxId={LISTBOX_ID}
              optionId={optionId}
              onPick={pick}
              onHover={setActiveIndex}
            />
          ) : null}
        </div>

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
          <HouseholdCard
            card={card}
            categories={categories}
            highlightProfileId={highlightProfileId}
          />
        ) : (
          <>
            <h2 style={{ fontSize: "var(--fp-text-xl)" }}>
              {servicesOnly ? "Homes offering help" : community.name}
            </h2>
            <p style={{ fontSize: "var(--fp-text-sm)", color: "var(--fp-ink-3)", marginTop: 4 }}>
              {filtered.features.length}{" "}
              {filtered.features.length === 1 ? "home" : "homes"}
              {servicesOnly ? " offer a neighbourhood service" : " on the map"}
            </p>

            {filtered.features.length === 0 ? (
              <p
                style={{
                  fontSize: "var(--fp-text-base)",
                  color: "var(--fp-ink-2)",
                  marginTop: "var(--fp-space-6)",
                }}
              >
                No neighbours have listed a service yet.
              </p>
            ) : (
              <div className="mt-4">
                {filtered.features.slice(0, 60).map((f) => (
                  <button
                    key={f.properties.id}
                    type="button"
                    onClick={() => openHousehold(f, null)}
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
