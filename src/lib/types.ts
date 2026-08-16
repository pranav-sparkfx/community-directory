/**
 * Domain types.
 *
 * These mirror the shapes returned by visible_households() and
 * household_card() — the two RPCs that ARE the privacy boundary. Note what is
 * absent: there is no `phone: string` anywhere. A phone number only ever
 * arrives inside a RedactedPhone, which carries the permission alongside the
 * value, so a component cannot render a call button for a number that was
 * only cleared for texting.
 */

export type PinKind = "default" | "selected" | "service" | "unlisted" | "cluster";

export interface RedactedPhone {
  /** null when the owner set phone_vis = 'hidden'. Never a masked string. */
  value: string | null;
  can_call: boolean;
  can_text: boolean;
}

export interface HouseholdFeatureProperties {
  id: string;
  address: string;
  unit: string | null;
  kind: "default" | "service";
  resident_count: number;
}

export interface HouseholdFeature {
  type: "Feature";
  id: string;
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: HouseholdFeatureProperties;
}

export interface HouseholdCollection {
  type: "FeatureCollection";
  features: HouseholdFeature[];
}

export interface CardMember {
  profile_id: string;
  name: string;
  relationship: "owner" | "renter" | "member";
  is_primary: boolean;
  resident_since: string | null;
  avatar_url: string | null;
  phone: RedactedPhone;
  /** null when the owner set email_vis = 'hidden'. */
  email: string | null;
}

export interface CardService {
  id: string;
  category: string;
  title: string;
}

export interface HouseholdCard {
  id: string;
  address: string;
  unit: string | null;
  city: string;
  state: string;
  postal_code: string;
  geo: { type: "Point"; coordinates: [number, number] } | null;
  community_id: string;
  members: CardMember[];
  services: CardService[];
  can_edit: boolean;
}

export interface ServiceCategory {
  slug: string;
  label: string;
  icon: string;
  accent: "forest" | "clay";
  sort_order: number;
}

export interface Community {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  /** Plain floats, not PostGIS WKB — see migration 20260814000006. */
  center_lng: number | null;
  center_lat: number | null;
  default_zoom: number;
}
