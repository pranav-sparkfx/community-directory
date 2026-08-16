/**
 * Front Porch icon set — inline SVG, stroke-based, 1.6 units on a 24 grid.
 *
 * Inline rather than an icon package: the whole set is under 3kB, it ships
 * no runtime, and `currentColor` lets every icon inherit the token colour of
 * whatever it sits inside. Names match the Figma component names.
 */

export type IconName =
  | "home"
  | "services"
  | "announcements"
  | "admin"
  | "search"
  | "filter"
  | "phone"
  | "message"
  | "directions"
  | "mail"
  | "chevron"
  | "paw"
  | "child"
  | "book"
  | "hammer"
  | "car"
  | "monitor"
  | "shield"
  | "people"
  | "plus"
  | "link"
  | "check"
  | "close"
  | "swap"
  | "bell";

const PATHS: Record<IconName, string> = {
  home: "M3 10.5 12 3l9 7.5M5.5 9.5V20h13V9.5",
  services: "M12 3v3M12 18v3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M3 12h3M18 12h3M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1",
  announcements: "M4 9v6h3l6 4V5L7 9H4ZM17 9.5a4 4 0 0 1 0 5",
  admin: "M12 3l7 3v6c0 4-3 7.5-7 9-4-1.5-7-5-7-9V6l7-3ZM9.5 12l1.8 1.8 3.4-3.6",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM16.5 16.5 21 21",
  filter: "M4 6h16M7 12h10M10 18h4",
  phone: "M6.5 3.5h3l1.5 4-2 1.5a12 12 0 0 0 6 6l1.5-2 4 1.5v3a2 2 0 0 1-2.2 2A17 17 0 0 1 4.5 5.7 2 2 0 0 1 6.5 3.5Z",
  message: "M4 5.5h16v10H9l-5 4v-14Z",
  directions: "M12 2.5 21.5 12 12 21.5 2.5 12 12 2.5ZM9.5 14v-2.5a2 2 0 0 1 2-2H15M13 7.5l2.2 2-2.2 2",
  mail: "M3 6h18v12H3V6ZM3 6.5l9 6.5 9-6.5",
  chevron: "M9 5l7 7-7 7",
  paw: "M8 9.5a1.7 1.7 0 1 1 0-3.4 1.7 1.7 0 0 1 0 3.4ZM16 9.5a1.7 1.7 0 1 1 0-3.4 1.7 1.7 0 0 1 0 3.4ZM5 14.5a1.6 1.6 0 1 1 0-3.2 1.6 1.6 0 0 1 0 3.2ZM19 14.5a1.6 1.6 0 1 1 0-3.2 1.6 1.6 0 0 1 0 3.2ZM12 12c2.5 0 4.5 2.2 4.5 4.4 0 1.6-1.2 2.6-2.8 2.6h-3.4c-1.6 0-2.8-1-2.8-2.6C7.5 14.2 9.5 12 12 12Z",
  child: "M12 4.5a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4ZM8 20v-4.5a4 4 0 0 1 8 0V20M10 14v6M14 14v6",
  book: "M4 5.5h6a2 2 0 0 1 2 2V20a2 2 0 0 0-2-2H4V5.5ZM20 5.5h-6a2 2 0 0 0-2 2V20a2 2 0 0 1 2-2h6V5.5Z",
  // Head as a rotated square, handle as an open stroke with a grip. The
  // earlier path closed the handle into a tapered polygon, which at 20px
  // read as a pencil — wrong tool for "Home Repair".
  hammer: "M13.5 3.5 20 10l-3 3-6.5-6.5 3-3ZM11 10 4.5 16.5a2.1 2.1 0 0 0 3 3L14 13",
  car: "M4 15v-3l2-5h12l2 5v3M4 15h16v3h-3v-3M4 15v3h3v-3M7.5 12h9",
  monitor: "M3 5h18v11H3V5ZM8.5 20h7M12 16v4",
  shield: "M12 3l7 3v6c0 4-3 7.5-7 9-4-1.5-7-5-7-9V6l7-3Z",
  people:
    "M9 10.5a2.6 2.6 0 1 1 0-5.2 2.6 2.6 0 0 1 0 5.2ZM3.5 19v-1.2A4 4 0 0 1 7.5 14h3a4 4 0 0 1 4 3.8V19M16 5.6a2.6 2.6 0 0 1 0 5.1M17.5 14a4 4 0 0 1 3 3.8V19",
  plus: "M12 5v14M5 12h14",
  // Two links of a chain, drawn as opposing arcs rather than one rounded
  // rectangle: at 18px a single outline reads as a pill, not a link.
  link: "M10.5 13.5a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1.2 1.2M13.5 10.5a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1.2-1.2",
  check: "m5 12.5 4.5 4.5L19 7",
  close: "M6 6l12 12M18 6 6 18",
  swap: "M4 8h13l-3.5-3.5M20 16H7l3.5 3.5",
  // A bell, not the megaphone: the megaphone already means "News" in
  // the tab bar, and one glyph meaning two things in the same frame is
  // how a nav stops being learnable.
  bell: "M18 15.5V11a6 6 0 0 0-12 0v4.5L4.5 18h15L18 15.5ZM10 18a2 2 0 0 0 4 0",
};

export function Icon({
  name,
  size = 20,
  className,
  strokeWidth = 1.6,
}: {
  name: IconName;
  size?: number;
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
