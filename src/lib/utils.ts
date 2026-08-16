import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge conditional class names, with later Tailwind utilities winning. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Initials for AvatarMonogram. Takes the first letter of the first and last
 * word, so "Murali Varadarajan" -> "MV" and a single-word name -> one letter.
 */
export function initials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.charAt(0).toUpperCase();
  return (
    parts[0]!.charAt(0) + parts[parts.length - 1]!.charAt(0)
  ).toUpperCase();
}

/**
 * Format a household's residents the way the mockups do:
 * one name plain, two joined with "&", more than two as "and N others".
 */
export function householdTitle(names: string[]): string {
  if (names.length === 0) return "Residence";
  if (names.length === 1) return names[0]!;
  if (names.length === 2) return `${names[0]} & ${names[1]}`;
  return `${names[0]} and ${names.length - 1} others`;
}

/**
 * "Mar 14" — the compact date stamp used on announcement cards.
 *
 * A bare "YYYY-MM-DD" is parsed by `new Date()` as UTC midnight, which is the
 * PREVIOUS evening anywhere west of Greenwich — so a notice dated the 14th
 * renders as "Mar 13" for every US resident. Date-only strings are therefore
 * split and constructed in local time. Full timestamps carry a zone already
 * and are passed through untouched.
 */
export function shortDate(value: string | Date): string {
  let d: Date;
  if (typeof value === "string") {
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    d = dateOnly
      ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
      : new Date(value);
  } else {
    d = value;
  }
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * "2 hours ago" for anything today, a short date after that.
 *
 * Notifications are read in two modes: skimming what happened since you last
 * looked, where elapsed time is the useful unit, and scrolling back through
 * older ones, where a date is. The cut-over is at a day rather than at an
 * arbitrary hour count so "yesterday" never renders as "26 hours ago".
 */
export function relativeDay(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);

  if (seconds < 60) return "just now";
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    return `${m} minute${m === 1 ? "" : "s"} ago`;
  }
  if (seconds < 86400) {
    const h = Math.floor(seconds / 3600);
    return `${h} hour${h === 1 ? "" : "s"} ago`;
  }
  if (seconds < 172800) return "yesterday";
  return shortDate(d);
}
