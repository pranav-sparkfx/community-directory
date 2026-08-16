-- ============================================================
-- Front Porch — break the households <-> household_members policy cycle
--
-- The remediation migration made households_read consult
-- household_members, while household_members_read already consulted
-- households. Postgres evaluates each table's policy while satisfying
-- the other's subquery, so every read of either table raised
--   ERROR: infinite recursion detected in policy for relation "households"
--
-- The fix is to answer those three questions in SECURITY DEFINER
-- functions, which bypass RLS and therefore terminate. Each one is
-- deliberately narrow: it returns a boolean about the CALLER's own
-- relationship to a row, never row data, so bypassing RLS inside them
-- discloses nothing a caller could not already establish.
-- ============================================================

-- Is the caller a current resident of this household?
create or replace function is_household_resident(target_household uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1 from household_members hm
    where hm.household_id = target_household
      and hm.profile_id = auth.uid()
      and hm.moved_out_at is null
  );
$$;

-- Does any verified, current member of this household consent to the pin?
-- This is the map opt-out, asked once and answered authoritatively.
create or replace function household_is_mapped(target_household uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1
    from household_members hm
    join households h   on h.id = hm.household_id
    join memberships mm on mm.profile_id = hm.profile_id
                       and mm.community_id = h.community_id
    where hm.household_id = target_household
      and hm.moved_out_at is null
      and mm.verification_status = 'verified'
      and mm.show_on_map
  );
$$;

-- Which community owns this household? Needed so household_members
-- policies can ask about roles without selecting from households.
create or replace function household_community(target_household uuid)
returns uuid
language sql
stable
security definer
set search_path = public, extensions
as $$
  select h.community_id from households h where h.id = target_household;
$$;

-- Is the named person listed and directory-visible at this household?
create or replace function member_is_listed(target_household uuid, target_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1
    from household_members hm
    join households h   on h.id = hm.household_id
    join memberships mm on mm.profile_id = hm.profile_id
                       and mm.community_id = h.community_id
    where hm.household_id = target_household
      and hm.profile_id = target_profile
      and hm.is_listed
      and hm.moved_out_at is null
      and mm.verification_status = 'verified'
      and mm.show_in_directory
  );
$$;

-- ---------- rewritten policies, no cross-table recursion ------

drop policy households_read on households;
create policy households_read on households
  for select using (
    is_verified_member(community_id)
    and status = 'active'
    and (
      is_household_resident(id)
      or has_role_at_or_above(community_id, 'admin')
      or household_is_mapped(id)
    )
  );

drop policy households_resident_update on households;
create policy households_resident_update on households
  for update using (is_household_resident(id))
  with check (is_household_resident(id));

drop policy household_members_read on household_members;
create policy household_members_read on household_members
  for select using (
    profile_id = auth.uid()
    or has_role_at_or_above(household_community(household_id), 'admin')
    or (
      is_verified_member(household_community(household_id))
      and member_is_listed(household_id, profile_id)
    )
  );

drop policy household_members_admin_write on household_members;
create policy household_members_admin_write on household_members
  for all using (has_role_at_or_above(household_community(household_id), 'admin'))
  with check (has_role_at_or_above(household_community(household_id), 'admin'));

-- household_card()'s WHERE clause had the same shape as the recursive
-- policy. It is SECURITY DEFINER so it never recursed, but restate it
-- through the helpers so the rule lives in exactly one place.
create or replace function household_card(target_household uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
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
                or is_household_resident(h.id)
  )
  from households h
  where h.id = target_household
    and h.status = 'active'
    and is_verified_member(h.community_id)
    and (
      is_household_resident(h.id)
      or has_role_at_or_above(h.community_id, 'admin')
      or household_is_mapped(h.id)
    );
$$;

-- visible_households() gains nothing from the helpers structurally, but
-- hoisting the caller check out of the per-row WHERE stops it being
-- re-evaluated once per candidate pin.
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
set search_path = public, extensions
as $$
  select case
    when not is_verified_member(target_community)
      then jsonb_build_object('type','FeatureCollection','features','[]'::jsonb)
    else (
      select jsonb_build_object(
        'type', 'FeatureCollection',
        'features', coalesce(jsonb_agg(f.feature), '[]'::jsonb)
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
            'kind', case
              when exists (select 1 from services s
                           where s.household_id = h.id and s.status = 'approved')
              then 'service' else 'default' end,
            'resident_count', (
              select count(*) from household_members hm
              join memberships mm on mm.profile_id = hm.profile_id
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
          and st_intersects(
            h.geo,
            st_makeenvelope(min_lng, min_lat, max_lng, max_lat, 4326)::geography
          )
          and household_is_mapped(h.id)
        limit 5000  -- a world-bbox call must not stream an entire community
      ) f
    )
  end;
$$;

grant execute on function is_household_resident(uuid)        to authenticated;
grant execute on function household_is_mapped(uuid)          to authenticated;
grant execute on function household_community(uuid)          to authenticated;
grant execute on function member_is_listed(uuid, uuid)       to authenticated;
grant execute on function household_card(uuid)               to authenticated;
grant execute on function visible_households(
  uuid, double precision, double precision, double precision, double precision
) to authenticated;
