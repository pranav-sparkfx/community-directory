-- ============================================================
-- Front Porch — core schema
-- Community Directory. See docs/PLAN.md §04.
--
-- Modeling rule that drives everything here: A MAP PIN IS A HOUSEHOLD,
-- NOT A PERSON. Households own the address and the pin; people attach
-- to households through household_members; a person's role, verification
-- state and privacy settings live on `memberships` (person x community).
-- ============================================================

create extension if not exists "postgis";
create extension if not exists "ltree";
create extension if not exists "pgcrypto";
create extension if not exists "unaccent";

-- ---------- enumerated types --------------------------------

create type community_visibility as enum ('public', 'private');
create type member_role          as enum ('resident', 'moderator', 'admin', 'owner');
create type verification_status  as enum ('unverified', 'pending', 'verified', 'rejected');
create type phone_visibility     as enum ('hidden', 'text_only', 'call_and_text');
create type email_visibility     as enum ('hidden', 'visible');
create type household_status     as enum ('active', 'inactive', 'merged');
create type household_relation   as enum ('owner', 'renter', 'member');
create type request_status       as enum ('pending', 'approved', 'rejected', 'withdrawn');
create type listing_status       as enum ('pending', 'approved', 'rejected');
create type announcement_kind    as enum ('hoa', 'neighbor');
create type report_status        as enum ('open', 'actioned', 'dismissed');

-- Ordinal for role comparison. Kept as a function rather than relying on
-- enum ordering so the enum can be extended without breaking comparisons.
create or replace function role_rank(r member_role)
returns int
language sql
immutable
parallel safe
as $$
  select case r
    when 'resident'  then 1
    when 'moderator' then 2
    when 'admin'     then 3
    when 'owner'     then 4
  end;
$$;

-- ---------- profiles ----------------------------------------
-- 1:1 with auth.users. Contact fields here are the RAW values; they are
-- never exposed directly. Every read goes through a redacting function
-- that applies the viewer's permissions (see the functions migration).

create table profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  full_name     text not null default '',
  avatar_url    text,
  email         text,
  phone         text,
  phone_verified_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ---------- communities -------------------------------------
-- Self-referencing tree. `path` is a materialized ltree of slugs used by
-- has_role_at_or_above() so downward role inheritance is one indexed
-- containment check instead of a recursive CTE on every policy call.

create table communities (
  id            uuid primary key default gen_random_uuid(),
  parent_id     uuid references communities (id) on delete restrict,
  path          ltree not null,
  name          text not null,
  slug          text not null,
  description   text,
  visibility    community_visibility not null default 'private',
  boundary      geography(Polygon, 4326),
  center        geography(Point, 4326),
  default_zoom  numeric(4,2) not null default 15.00,
  owner_id      uuid references profiles (id) on delete restrict,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint communities_slug_unique_per_parent unique nulls not distinct (parent_id, slug),
  constraint communities_not_own_parent check (parent_id is null or parent_id <> id)
);

create index communities_path_gist   on communities using gist (path);
create index communities_parent_idx  on communities (parent_id);
create index communities_center_gist on communities using gist (center);
create index communities_public_idx  on communities (visibility) where visibility = 'public';

-- ---------- households --------------------------------------
-- One row per map pin. normalized_key is the dedupe spine: it is derived
-- from the address by a deterministic normalizer (lib/address.ts and
-- normalize_address_key() must stay in agreement) and is unique per
-- community, which is what makes duplicate detection possible.

create table households (
  id             uuid primary key default gen_random_uuid(),
  community_id   uuid not null references communities (id) on delete cascade,
  address_line1  text not null,
  unit           text,
  city           text not null default '',
  state          text not null default '',
  postal_code    text not null default '',
  normalized_key text not null,
  geo            geography(Point, 4326),
  photo_path     text,
  notes          text,
  status         household_status not null default 'active',
  merged_into_id uuid references households (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint households_key_unique_per_community unique (community_id, normalized_key),
  constraint households_merge_target_differs check (merged_into_id is null or merged_into_id <> id),
  constraint households_merged_has_target check (status <> 'merged' or merged_into_id is not null)
);

create index households_community_idx on households (community_id);
create index households_geo_gist       on households using gist (geo);
create index households_active_idx     on households (community_id, status) where status = 'active';

-- ---------- household_members -------------------------------
-- Who lives at a pin. is_listed is the household-level opt-out: a member
-- who is not listed is never named on the household card, even to
-- verified neighbors.

create table household_members (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references households (id) on delete cascade,
  profile_id     uuid not null references profiles (id) on delete cascade,
  relationship   household_relation not null default 'member',
  is_primary     boolean not null default false,
  is_listed      boolean not null default true,
  display_name   text,
  resident_since date,
  moved_out_at   date,
  created_at     timestamptz not null default now(),
  constraint household_members_unique unique (household_id, profile_id)
);

create index household_members_household_idx on household_members (household_id);
create index household_members_profile_idx   on household_members (profile_id);
create unique index household_members_one_primary
  on household_members (household_id) where is_primary;

-- ---------- memberships -------------------------------------
-- Person x community. Carries role, verification state, and the privacy
-- settings. This table is the authorization and privacy spine; nearly
-- every RLS policy in the system reads it.

create table memberships (
  id                  uuid primary key default gen_random_uuid(),
  community_id        uuid not null references communities (id) on delete cascade,
  profile_id          uuid not null references profiles (id) on delete cascade,
  household_id        uuid references households (id) on delete set null,
  role                member_role not null default 'resident',
  verification_status verification_status not null default 'unverified',
  verified_at         timestamptz,
  verified_by         uuid references profiles (id) on delete set null,
  rejection_reason    text,
  -- Privacy. Defaults are deliberately conservative: listed and on the
  -- map so the directory is useful, but text-only phone and hidden email
  -- so turning visibility UP is always an explicit act.
  phone_vis           phone_visibility not null default 'text_only',
  email_vis           email_visibility not null default 'hidden',
  show_on_map         boolean not null default true,
  show_in_directory   boolean not null default true,
  joined_at           timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint memberships_unique unique (community_id, profile_id)
);

create index memberships_community_idx  on memberships (community_id);
create index memberships_profile_idx    on memberships (profile_id);
create index memberships_household_idx  on memberships (household_id);
create index memberships_pending_idx    on memberships (community_id, verification_status)
  where verification_status = 'pending';
create index memberships_visible_idx    on memberships (community_id)
  where verification_status = 'verified';

-- ---------- access requests ---------------------------------

create table invites (
  id           uuid primary key default gen_random_uuid(),
  community_id uuid not null references communities (id) on delete cascade,
  code         text not null unique,
  email        text,
  household_id uuid references households (id) on delete set null,
  role         member_role not null default 'resident',
  created_by   uuid not null references profiles (id) on delete cascade,
  max_uses     int not null default 1,
  use_count    int not null default 0,
  expires_at   timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now(),
  constraint invites_uses_sane check (use_count >= 0 and use_count <= max_uses)
);

create index invites_community_idx on invites (community_id);

create table invite_redemptions (
  id          uuid primary key default gen_random_uuid(),
  invite_id   uuid not null references invites (id) on delete cascade,
  profile_id  uuid not null references profiles (id) on delete cascade,
  redeemed_at timestamptz not null default now(),
  constraint invite_redemptions_unique unique (invite_id, profile_id)
);

create table join_requests (
  id                   uuid primary key default gen_random_uuid(),
  community_id         uuid not null references communities (id) on delete cascade,
  profile_id           uuid not null references profiles (id) on delete cascade,
  claimed_household_id uuid references households (id) on delete set null,
  claimed_address      text,
  note                 text,
  status               request_status not null default 'pending',
  decided_by           uuid references profiles (id) on delete set null,
  decided_at           timestamptz,
  decision_reason      text,
  created_at           timestamptz not null default now()
);

create index join_requests_community_idx on join_requests (community_id, status);
create unique index join_requests_one_open
  on join_requests (community_id, profile_id) where status = 'pending';

create table community_requests (
  id             uuid primary key default gen_random_uuid(),
  parent_id      uuid references communities (id) on delete cascade,
  requester_id   uuid not null references profiles (id) on delete cascade,
  proposed_name  text not null,
  proposed_slug  text not null,
  note           text,
  status         request_status not null default 'pending',
  decided_by     uuid references profiles (id) on delete set null,
  decided_at     timestamptz,
  decision_reason text,
  created_community_id uuid references communities (id) on delete set null,
  created_at     timestamptz not null default now()
);

create index community_requests_parent_idx on community_requests (parent_id, status);

-- ---------- content -----------------------------------------

create table announcements (
  id           uuid primary key default gen_random_uuid(),
  community_id uuid not null references communities (id) on delete cascade,
  author_id    uuid references profiles (id) on delete set null,
  kind         announcement_kind not null default 'hoa',
  title        text not null,
  body         text not null default '',
  pinned       boolean not null default false,
  publish_at   timestamptz not null default now(),
  expires_at   timestamptz,
  -- Audience targeting. {} means the whole community; may carry
  -- {"sub_community_ids": [...]} to scope to descendants.
  audience     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index announcements_feed_idx on announcements (community_id, pinned desc, publish_at desc);

create table events (
  id           uuid primary key default gen_random_uuid(),
  community_id uuid not null references communities (id) on delete cascade,
  author_id    uuid references profiles (id) on delete set null,
  title        text not null,
  body         text not null default '',
  location     text,
  geo          geography(Point, 4326),
  starts_at    timestamptz not null,
  ends_at      timestamptz,
  all_day      boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint events_end_after_start check (ends_at is null or ends_at >= starts_at)
);

create index events_range_idx on events (community_id, starts_at);

create table service_categories (
  slug       text primary key,
  label      text not null,
  icon       text not null default 'sparkle',
  accent     text not null default 'forest',
  sort_order int not null default 0
);

create table services (
  id           uuid primary key default gen_random_uuid(),
  community_id uuid not null references communities (id) on delete cascade,
  profile_id   uuid not null references profiles (id) on delete cascade,
  household_id uuid references households (id) on delete set null,
  category     text not null references service_categories (slug) on delete restrict,
  title        text not null,
  description  text not null default '',
  availability text,
  rate_note    text,
  status       listing_status not null default 'pending',
  decided_by   uuid references profiles (id) on delete set null,
  decided_at   timestamptz,
  decision_reason text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index services_community_idx on services (community_id, category, status);
create index services_approved_idx  on services (community_id, category)
  where status = 'approved';
create index services_profile_idx   on services (profile_id);

-- ---------- moderation & operations -------------------------

create table reports (
  id           uuid primary key default gen_random_uuid(),
  community_id uuid not null references communities (id) on delete cascade,
  target_type  text not null check (target_type in ('service', 'announcement', 'profile', 'household', 'event')),
  target_id    uuid not null,
  reporter_id  uuid not null references profiles (id) on delete cascade,
  reason       text not null,
  detail       text,
  status       report_status not null default 'open',
  resolved_by  uuid references profiles (id) on delete set null,
  resolved_at  timestamptz,
  resolution   text,
  created_at   timestamptz not null default now()
);

create index reports_open_idx on reports (community_id, status) where status = 'open';

create table notifications (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references profiles (id) on delete cascade,
  community_id uuid references communities (id) on delete cascade,
  kind         text not null,
  title        text not null,
  body         text,
  link         text,
  payload      jsonb not null default '{}'::jsonb,
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);

create index notifications_inbox_idx on notifications (profile_id, created_at desc);
create index notifications_unread_idx on notifications (profile_id) where read_at is null;

-- Every admin action against a resident record lands here. Non-negotiable
-- for a system where volunteers hold edit rights over neighbors' data.
create table audit_log (
  id           uuid primary key default gen_random_uuid(),
  community_id uuid references communities (id) on delete set null,
  actor_id     uuid references profiles (id) on delete set null,
  action       text not null,
  target_type  text not null,
  target_id    uuid,
  diff         jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

create index audit_log_community_idx on audit_log (community_id, created_at desc);

-- ---------- updated_at maintenance --------------------------

create or replace function touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'profiles', 'communities', 'households', 'memberships',
    'announcements', 'events', 'services'
  ] loop
    execute format(
      'create trigger %I_touch before update on %I
         for each row execute function touch_updated_at()',
      t, t
    );
  end loop;
end;
$$;
