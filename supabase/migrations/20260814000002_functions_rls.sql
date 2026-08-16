-- ============================================================
-- Front Porch — authorization functions and row-level security
--
-- THE RULE: privacy is resolved in Postgres, never in React.
-- A hidden phone number is ABSENT from the response payload, not
-- merely unrendered. Nothing below may be relaxed to "the UI hides it".
--
-- THE GATE: a membership whose verification_status is not 'verified'
-- appears on no map, in no directory, in no search result.
-- ============================================================

-- ---------- identity ----------------------------------------

create or replace function current_profile_id()
returns uuid
language sql
stable
as $$
  select auth.uid();
$$;

-- ---------- role resolution ---------------------------------
-- Roles inherit DOWNWARD through the community tree and never upward.
-- A parent-HOA admin governs every sub-community; a sub-community
-- admin has no authority over the parent. One indexed ltree ancestor
-- check does the whole job.

create or replace function has_role_at_or_above(
  target_community uuid,
  min_role member_role
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from memberships m
    join communities target on target.id = target_community
    join communities held   on held.id = m.community_id
    where m.profile_id = auth.uid()
      and m.verification_status = 'verified'
      and role_rank(m.role) >= role_rank(min_role)
      -- held.path must be an ancestor of (or equal to) target.path
      and target.path <@ held.path
  );
$$;

-- Plain membership test: is the caller a VERIFIED member of this
-- community or any of its ancestors? Ancestors included so a parent
-- resident can browse a sub-community they belong to.
create or replace function is_verified_member(target_community uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from memberships m
    join communities target on target.id = target_community
    join communities held   on held.id = m.community_id
    where m.profile_id = auth.uid()
      and m.verification_status = 'verified'
      and target.path <@ held.path
  );
$$;

-- ---------- address normalization ---------------------------
-- MUST stay in agreement with src/lib/address.ts. The unit test in
-- src/lib/address.test.ts asserts both produce identical keys for a
-- shared fixture list; if you change one, change both.

create or replace function normalize_address_key(
  line1 text,
  unit text default null
)
returns text
language sql
immutable
parallel safe
as $$
  select trim(both '-' from regexp_replace(
    lower(unaccent(
      coalesce(line1, '') ||
      case when coalesce(unit, '') = '' then '' else ' ' || unit end
    )),
    '[^a-z0-9]+', '-', 'g'
  ));
$$;

-- ---------- contact redaction -------------------------------
-- The single place where a phone or email is allowed to leave the
-- database. Applies the OWNER's stated visibility, not the viewer's
-- appetite. Admins get no special contact access: an admin may edit a
-- household record, but hiding a number hides it from them too.

create or replace function redact_phone(
  raw_phone text,
  vis phone_visibility
)
returns jsonb
language sql
immutable
parallel safe
as $$
  select case
    when raw_phone is null or vis = 'hidden'
      then jsonb_build_object('value', null, 'can_call', false, 'can_text', false)
    when vis = 'text_only'
      then jsonb_build_object('value', raw_phone, 'can_call', false, 'can_text', true)
    else jsonb_build_object('value', raw_phone, 'can_call', true, 'can_text', true)
  end;
$$;

create or replace function redact_email(
  raw_email text,
  vis email_visibility
)
returns text
language sql
immutable
parallel safe
as $$
  select case when vis = 'visible' then raw_email else null end;
$$;

-- ---------- map read ----------------------------------------
-- Returns ONLY pins the caller may see, as GeoJSON. Never returns
-- contact data — the card RPC does that, under the same policy chain.

create or replace function visible_households(
  target_community uuid,
  min_lng double precision default -180,
  min_lat double precision default -90,
  max_lng double precision default 180,
  max_lat double precision default 90
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_build_object(
      'type', 'FeatureCollection',
      'features', coalesce(jsonb_agg(f.feature), '[]'::jsonb)
    ),
    jsonb_build_object('type', 'FeatureCollection', 'features', '[]'::jsonb)
  )
  from (
    select jsonb_build_object(
      'type', 'Feature',
      'id', h.id,
      'geometry', st_asgeojson(h.geo)::jsonb,
      'properties', jsonb_build_object(
        'id', h.id,
        'address', h.address_line1,
        'unit', h.unit,
        -- 'service' when anyone at this household has an approved
        -- listing; drives the terracotta MapPin Kind=Service.
        'kind', case
          when exists (
            select 1 from services s
            where s.household_id = h.id and s.status = 'approved'
          ) then 'service'
          else 'default'
        end,
        'resident_count', (
          select count(*) from household_members hm
          join memberships mm
            on mm.profile_id = hm.profile_id
           and mm.community_id = h.community_id
          where hm.household_id = h.id
            and hm.is_listed
            and hm.moved_out_at is null
            and mm.verification_status = 'verified'
            and mm.show_in_directory
        )
      )
    ) as feature
    from households h
    where h.community_id = target_community
      and h.status = 'active'
      and h.geo is not null
      and is_verified_member(target_community)
      and st_intersects(
        h.geo,
        st_makeenvelope(min_lng, min_lat, max_lng, max_lat, 4326)::geography
      )
      -- The map opt-out is ABSOLUTE. If every verified member of this
      -- household has show_on_map = false, the pin does not exist in
      -- the source at all — we do not emit an "unlisted" marker that
      -- would still disclose that someone lives there.
      and exists (
        select 1
        from household_members hm
        join memberships mm
          on mm.profile_id = hm.profile_id
         and mm.community_id = h.community_id
        where hm.household_id = h.id
          and hm.moved_out_at is null
          and mm.verification_status = 'verified'
          and mm.show_on_map
      )
  ) f;
$$;

-- ---------- household card ----------------------------------
-- Listed members with contact fields already redacted, plus the set of
-- actions the caller is permitted to take.

create or replace function household_card(target_household uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', h.id,
    'address', h.address_line1,
    'unit', h.unit,
    'city', h.city,
    'state', h.state,
    'postal_code', h.postal_code,
    'geo', st_asgeojson(h.geo)::jsonb,
    'community_id', h.community_id,
    'members', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'profile_id', p.id,
          'name', coalesce(nullif(hm.display_name, ''), p.full_name),
          'relationship', hm.relationship,
          'is_primary', hm.is_primary,
          'resident_since', hm.resident_since,
          'avatar_url', p.avatar_url,
          'phone', redact_phone(p.phone, mm.phone_vis),
          'email', redact_email(p.email, mm.email_vis)
        )
        order by hm.is_primary desc, p.full_name
      )
      from household_members hm
      join profiles p     on p.id = hm.profile_id
      join memberships mm on mm.profile_id = hm.profile_id
                         and mm.community_id = h.community_id
      where hm.household_id = h.id
        and hm.is_listed
        and hm.moved_out_at is null
        and mm.verification_status = 'verified'
        and mm.show_in_directory
    ), '[]'::jsonb),
    'services', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', s.id, 'category', s.category, 'title', s.title)
        order by s.created_at
      )
      from services s
      where s.household_id = h.id and s.status = 'approved'
    ), '[]'::jsonb),
    'can_edit', has_role_at_or_above(h.community_id, 'admin')
                or exists (
                  select 1 from household_members hm2
                  where hm2.household_id = h.id
                    and hm2.profile_id = auth.uid()
                    and hm2.moved_out_at is null
                )
  )
  from households h
  where h.id = target_household
    and h.status = 'active'
    and is_verified_member(h.community_id);
$$;

-- ============================================================
-- Row-level security
-- Default posture is deny. Every table gets RLS enabled; a table
-- without an explicit policy is unreadable, which is the correct
-- failure mode for this product.
-- ============================================================

alter table profiles           enable row level security;
alter table communities        enable row level security;
alter table households         enable row level security;
alter table household_members  enable row level security;
alter table memberships        enable row level security;
alter table invites            enable row level security;
alter table invite_redemptions enable row level security;
alter table join_requests      enable row level security;
alter table community_requests enable row level security;
alter table announcements      enable row level security;
alter table events             enable row level security;
alter table service_categories enable row level security;
alter table services           enable row level security;
alter table reports            enable row level security;
alter table notifications      enable row level security;
alter table audit_log          enable row level security;

-- ---------- profiles ----------------------------------------
-- A profile row carries raw contact data, so direct SELECT is limited
-- to the owner. Neighbors see people only through household_card(),
-- which redacts. This is deliberate: there is no path by which a
-- client reads another person's raw phone number.

create policy profiles_self_read on profiles
  for select using (id = auth.uid());

create policy profiles_self_write on profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

create policy profiles_self_insert on profiles
  for insert with check (id = auth.uid());

-- ---------- communities -------------------------------------

create policy communities_read on communities
  for select using (
    visibility = 'public'
    or is_verified_member(id)
    or exists (
      select 1 from memberships m
      where m.community_id = communities.id and m.profile_id = auth.uid()
    )
  );

create policy communities_insert on communities
  for insert with check (owner_id = auth.uid());

create policy communities_update on communities
  for update using (has_role_at_or_above(id, 'admin'))
  with check (has_role_at_or_above(id, 'admin'));

create policy communities_delete on communities
  for delete using (has_role_at_or_above(id, 'owner'));

-- ---------- households --------------------------------------

create policy households_read on households
  for select using (is_verified_member(community_id));

create policy households_write on households
  for all using (has_role_at_or_above(community_id, 'admin'))
  with check (has_role_at_or_above(community_id, 'admin'));

-- A resident may correct their own household's address details.
create policy households_resident_update on households
  for update using (
    exists (
      select 1 from household_members hm
      where hm.household_id = households.id
        and hm.profile_id = auth.uid()
        and hm.moved_out_at is null
    )
  );

-- ---------- household_members -------------------------------

create policy household_members_read on household_members
  for select using (
    profile_id = auth.uid()
    or exists (
      select 1 from households h
      where h.id = household_members.household_id
        and is_verified_member(h.community_id)
    )
  );

create policy household_members_self_write on household_members
  for all using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

create policy household_members_admin_write on household_members
  for all using (
    exists (
      select 1 from households h
      where h.id = household_members.household_id
        and has_role_at_or_above(h.community_id, 'admin')
    )
  )
  with check (
    exists (
      select 1 from households h
      where h.id = household_members.household_id
        and has_role_at_or_above(h.community_id, 'admin')
    )
  );

-- ---------- memberships -------------------------------------

create policy memberships_read on memberships
  for select using (
    profile_id = auth.uid()
    or has_role_at_or_above(community_id, 'moderator')
    or (verification_status = 'verified' and is_verified_member(community_id))
  );

-- A resident owns their own privacy settings. The WITH CHECK clause
-- deliberately does NOT constrain the privacy columns — turning your
-- own visibility down must always succeed.
create policy memberships_self_update on memberships
  for update using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

create policy memberships_self_insert on memberships
  for insert with check (profile_id = auth.uid());

create policy memberships_admin_write on memberships
  for all using (has_role_at_or_above(community_id, 'admin'))
  with check (has_role_at_or_above(community_id, 'admin'));

-- ---------- invites & requests ------------------------------

create policy invites_admin on invites
  for all using (has_role_at_or_above(community_id, 'admin'))
  with check (has_role_at_or_above(community_id, 'admin'));

create policy invite_redemptions_self on invite_redemptions
  for all using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

create policy join_requests_self on join_requests
  for all using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

create policy join_requests_admin on join_requests
  for all using (has_role_at_or_above(community_id, 'moderator'))
  with check (has_role_at_or_above(community_id, 'moderator'));

create policy community_requests_self on community_requests
  for all using (requester_id = auth.uid())
  with check (requester_id = auth.uid());

create policy community_requests_admin on community_requests
  for all using (parent_id is not null and has_role_at_or_above(parent_id, 'admin'))
  with check (parent_id is not null and has_role_at_or_above(parent_id, 'admin'));

-- ---------- content -----------------------------------------

create policy announcements_read on announcements
  for select using (is_verified_member(community_id) and publish_at <= now());

create policy announcements_write on announcements
  for all using (has_role_at_or_above(community_id, 'moderator'))
  with check (has_role_at_or_above(community_id, 'moderator'));

create policy events_read on events
  for select using (is_verified_member(community_id));

create policy events_write on events
  for all using (has_role_at_or_above(community_id, 'moderator'))
  with check (has_role_at_or_above(community_id, 'moderator'));

create policy service_categories_read on service_categories
  for select using (auth.uid() is not null);

-- A pending listing is visible to its author and to moderators, and to
-- nobody else. This is what makes "vet before it's public" real.
create policy services_read on services
  for select using (
    (status = 'approved' and is_verified_member(community_id))
    or profile_id = auth.uid()
    or has_role_at_or_above(community_id, 'moderator')
  );

create policy services_author_write on services
  for all using (profile_id = auth.uid())
  with check (profile_id = auth.uid() and is_verified_member(community_id));

create policy services_moderator_write on services
  for all using (has_role_at_or_above(community_id, 'moderator'))
  with check (has_role_at_or_above(community_id, 'moderator'));

-- ---------- moderation & operations -------------------------

create policy reports_insert on reports
  for insert with check (reporter_id = auth.uid() and is_verified_member(community_id));

create policy reports_read on reports
  for select using (
    reporter_id = auth.uid() or has_role_at_or_above(community_id, 'moderator')
  );

create policy reports_moderate on reports
  for update using (has_role_at_or_above(community_id, 'moderator'))
  with check (has_role_at_or_above(community_id, 'moderator'));

create policy notifications_self on notifications
  for all using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

-- Read-only to admins. There is no client-side INSERT policy: audit
-- rows are written by SECURITY DEFINER routines and triggers only, so
-- an actor cannot forge or suppress their own trail.
create policy audit_log_admin_read on audit_log
  for select using (
    community_id is not null and has_role_at_or_above(community_id, 'admin')
  );

-- ---------- grants ------------------------------------------

grant execute on function current_profile_id()                to authenticated;
grant execute on function has_role_at_or_above(uuid, member_role) to authenticated;
grant execute on function is_verified_member(uuid)            to authenticated;
grant execute on function normalize_address_key(text, text)   to authenticated;
grant execute on function visible_households(
  uuid, double precision, double precision, double precision, double precision
) to authenticated;
grant execute on function household_card(uuid)                to authenticated;

-- Anonymous callers get nothing. Every read in this product requires
-- an authenticated, verified member.
revoke all on all tables in schema public from anon;
