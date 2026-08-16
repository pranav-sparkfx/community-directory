import { AvatarMonogram, AvatarPair } from "@/components/ui/Avatar";
import { AnnouncementCard } from "@/components/announcements/AnnouncementCard";
import {
  ActionButton,
  FilterChip,
  SearchField,
  SectionHeader,
  StatusPill,
} from "@/components/ui/Controls";
import { MapPin, PinCallout } from "@/components/map/MapPin";
import { ResidentRow } from "@/components/directory/ResidentRow";
import { ServiceCard } from "@/components/services/ServiceCard";
import { ServiceTag } from "@/components/ui/ServiceTag";

export const metadata = { title: "Front Porch — Style Guide" };

/**
 * The Phase 0 exit test: every design token and every primitive rendered on
 * one page, so a drift in tokens.css is visible immediately rather than
 * discovered three screens later.
 *
 * Content is the Summerlake seed data verbatim, not lorem — a primitive that
 * only looks right under placeholder text is not actually right.
 */

const COLORS = [
  ["paper", "--fp-paper"], ["map-base", "--fp-map-base"],
  ["surface", "--fp-surface"], ["surface-sunk", "--fp-surface-sunk"],
  ["ink", "--fp-ink"], ["ink-2", "--fp-ink-2"], ["ink-3", "--fp-ink-3"],
  ["line", "--fp-line"], ["forest", "--fp-forest"], ["forest-hi", "--fp-forest-hi"],
  ["forest-wash", "--fp-forest-wash"], ["clay", "--fp-clay"],
  ["clay-wash", "--fp-clay-wash"], ["map-green", "--fp-map-green"],
  ["map-water", "--fp-map-water"], ["map-parcel", "--fp-map-parcel"],
];

const SEMANTIC = [
  ["verified", "--fp-verified"], ["pending", "--fp-pending"],
  ["rejected", "--fp-rejected"], ["flagged", "--fp-flagged"], ["info", "--fp-info"],
];

const TYPE = [
  ["2xl / screen title", "--fp-text-2xl", "display"],
  ["xl / household name", "--fp-text-xl", "display"],
  ["lg / card heading", "--fp-text-lg", "display"],
  ["md / row title", "--fp-text-md", "display"],
  ["base / body", "--fp-text-base", "body"],
  ["sm / meta", "--fp-text-sm", "body"],
  ["xs / eyebrow", "--fp-text-xs", "body"],
];

const SPACE = ["1", "2", "3", "4", "5", "6", "8", "10", "12"];
const RADIUS = ["sm", "md", "lg", "xl", "sheet"];

function Block({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: "var(--fp-space-10)" }}>
      <h2
        style={{
          fontSize: "var(--fp-text-lg)",
          paddingBottom: "var(--fp-space-2)",
          borderBottom: "1px solid var(--fp-line)",
        }}
      >
        {title}
      </h2>
      {note ? (
        <p style={{ fontSize: "var(--fp-text-sm)", color: "var(--fp-ink-3)", marginTop: 8, maxWidth: "62ch" }}>
          {note}
        </p>
      ) : null}
      <div style={{ marginTop: "var(--fp-space-5)" }}>{children}</div>
    </section>
  );
}

export default function StyleGuidePage() {
  return (
    <main style={{ maxWidth: 820, margin: "0 auto", padding: "var(--fp-space-8) var(--fp-space-5) var(--fp-space-12)" }}>
      <SectionHeader eyebrow="Summerlake · Front Porch" title="Style guide" />
      <p style={{ color: "var(--fp-ink-2)", marginTop: "var(--fp-space-4)", maxWidth: "62ch" }}>
        Every token in <code>tokens.css</code> and every primitive named to match its
        Figma symbol. If something here looks wrong, the system is wrong — not the screen
        that uses it.
      </p>

      <Block title="Colour" note="Forest carries structure. Clay is an accent, used sparingly — eyebrows, service pins, service tags.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "var(--fp-space-3)" }}>
          {COLORS.map(([name, token]) => (
            <div key={token}>
              <div style={{ height: 52, borderRadius: "var(--fp-radius-md)", background: `var(${token})`, border: "1px solid var(--fp-line)" }} />
              <p style={{ fontSize: "var(--fp-text-xs)", marginTop: 6, color: "var(--fp-ink-2)" }}>{name}</p>
            </div>
          ))}
        </div>
      </Block>

      <Block title="Semantic colour" note="Deliberately separate from the brand accent. Verification and moderation state must never read as decoration.">
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--fp-space-4)" }}>
          {SEMANTIC.map(([name, token]) => (
            <div key={token} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 22, height: 22, borderRadius: 6, background: `var(${token})` }} />
              <span style={{ fontSize: "var(--fp-text-sm)", color: "var(--fp-ink-2)" }}>{name}</span>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--fp-space-2)", marginTop: "var(--fp-space-4)" }}>
          <StatusPill status="verified" />
          <StatusPill status="pending" />
          <StatusPill status="rejected" />
          <StatusPill status="unverified" />
        </div>
      </Block>

      <Block title="Type" note="Source Serif 4 for display; the platform UI stack for body, so it renders as SF on iOS and Roboto on Android.">
        {TYPE.map(([label, token, family]) => (
          <p
            key={token}
            style={{
              fontSize: `var(${token})`,
              fontFamily: family === "display" ? "var(--fp-font-display)" : "var(--fp-font-body)",
              fontWeight: family === "display" ? 600 : 400,
              marginBottom: "var(--fp-space-3)",
              lineHeight: "var(--fp-leading-snug)",
            }}
          >
            2640 Flintgrove Rd <span style={{ fontSize: "var(--fp-text-xs)", color: "var(--fp-ink-3)", fontFamily: "var(--fp-font-mono)" }}>{label}</span>
          </p>
        ))}
        <p className="fp-eyebrow">Eyebrow · clay · tracked</p>
      </Block>

      <Block title="Space & radius" note="4px base. The 44px tap minimum is a token, so an audit can widen every control at once.">
        <div style={{ display: "flex", alignItems: "flex-end", gap: "var(--fp-space-2)", flexWrap: "wrap" }}>
          {SPACE.map((s) => (
            <div key={s} style={{ textAlign: "center" }}>
              <div style={{ width: `var(--fp-space-${s})`, height: `var(--fp-space-${s})`, background: "var(--fp-forest)", borderRadius: 2 }} />
              <p style={{ fontSize: "var(--fp-text-xs)", color: "var(--fp-ink-3)", marginTop: 4 }}>{s}</p>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: "var(--fp-space-3)", marginTop: "var(--fp-space-5)", flexWrap: "wrap" }}>
          {RADIUS.map((r) => (
            <div key={r} style={{ textAlign: "center" }}>
              <div style={{ width: 60, height: 60, background: "var(--fp-forest-wash)", border: "1px solid var(--fp-line)", borderRadius: `var(--fp-radius-${r})` }} />
              <p style={{ fontSize: "var(--fp-text-xs)", color: "var(--fp-ink-3)", marginTop: 4 }}>{r}</p>
            </div>
          ))}
        </div>
      </Block>

      <Block title="MapPin" note="Unlisted is NOT the map opt-out. A household that opted out emits no marker at all — a grey pin at a real address still discloses that someone lives there.">
        <div style={{ display: "flex", alignItems: "flex-end", gap: "var(--fp-space-6)", background: "var(--fp-map-base)", padding: "var(--fp-space-5)", borderRadius: "var(--fp-radius-lg)" }}>
          {(["default", "selected", "service", "unlisted"] as const).map((k) => (
            <div key={k} style={{ textAlign: "center" }}>
              <MapPin kind={k} />
              <p style={{ fontSize: "var(--fp-text-xs)", color: "var(--fp-ink-2)", marginTop: 6 }}>{k}</p>
            </div>
          ))}
          <div style={{ textAlign: "center" }}>
            <MapPin kind="cluster" count={12} />
            <p style={{ fontSize: "var(--fp-text-xs)", color: "var(--fp-ink-2)", marginTop: 6 }}>cluster</p>
          </div>
          <div style={{ textAlign: "center" }}>
            <PinCallout label="2640 Flintgrove Rd" />
            <p style={{ fontSize: "var(--fp-text-xs)", color: "var(--fp-ink-2)", marginTop: 6 }}>callout</p>
          </div>
        </div>
      </Block>

      <Block title="Avatar">
        <div style={{ display: "flex", alignItems: "center", gap: "var(--fp-space-6)" }}>
          <AvatarMonogram name="Murali Varadarajan" />
          <AvatarPair names={["Murali Varadarajan", "Jaya Swamy"]} />
          <AvatarPair names={["Dana Okafor"]} />
        </div>
      </Block>

      <Block title="Chips, tags & search">
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--fp-space-2)" }}>
          <FilterChip label="Find Help" icon="people" />
          <FilterChip label="New Residents" icon="home" count={2} active />
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--fp-space-2)", marginTop: "var(--fp-space-4)" }}>
          <ServiceTag label="Pet Care" icon="paw" accent="clay" />
          <ServiceTag label="Babysitting" icon="child" accent="forest" />
          <ServiceTag label="Tutoring" icon="book" accent="clay" />
        </div>
        <div style={{ marginTop: "var(--fp-space-4)" }}>
          <SearchField />
        </div>
      </Block>

      <Block title="ActionButton" note="Disabled is a first-class state. When a resident hides their number the control stays, inert and explained, so the absence reads as their choice rather than a broken app.">
        <div style={{ display: "flex", gap: "var(--fp-space-6)" }}>
          <ActionButton label="Call" icon="phone" href="tel:+17045550001" />
          <ActionButton label="Text" icon="message" href="sms:+17045550001" />
          <ActionButton label="Directions" icon="directions" href="#" />
          <ActionButton label="Email" icon="mail" disabled disabledReason="This neighbour has hidden their email address." />
        </div>
      </Block>

      <Block title="ResidentRow">
        <div className="fp-card" style={{ overflow: "hidden" }}>
          <ResidentRow address="2640 Flintgrove Rd" names={["Murali Varadarajan", "Jaya Swamy"]} meta="Residents since 2019" href="#" />
          <div style={{ height: 1, background: "var(--fp-line-soft)" }} />
          <ResidentRow address="14 Oak Lane" names={["Dana Okafor"]} href="#" />
        </div>
      </Block>

      <Block title="ServiceCard">
        <div style={{ display: "grid", gap: "var(--fp-space-3)" }}>
          <ServiceCard label="Pet Care" icon="paw" accent="clay" neighbourCount={6} href="#" />
          <ServiceCard label="Babysitting" icon="child" accent="forest" neighbourCount={4} note="evenings" href="#" />
          <ServiceCard label="Tutoring" icon="book" accent="clay" neighbourCount={3} note="math, piano" href="#" />
        </div>
      </Block>

      <Block title="AnnouncementCard">
        <div style={{ display: "grid", gap: "var(--fp-space-3)" }}>
          <AnnouncementCard
            kind="hoa"
            title="Spring hydrant flushing, Mar 18–20"
            body="Water may run cloudy for a few hours. Run cold taps until clear before doing laundry."
            publishedAt="2026-03-14"
          />
          <AnnouncementCard
            kind="neighbor"
            title="Lost tabby near Willow Run"
            body="Grey with a white chest, answers to Pepper. Text the Alvarez household if you spot her."
            publishedAt="2026-03-06"
          />
        </div>
      </Block>

      <div style={{ height: "var(--fp-space-12)" }} />
    </main>
  );
}
