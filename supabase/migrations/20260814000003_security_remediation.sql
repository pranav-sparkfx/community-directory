-- ============================================================
-- Front Porch — security remediation
--
-- Closes the findings from the Phase 0 review. The root defect was
-- architectural, not logical: visible_households() and household_card()
-- were treated as the privacy boundary, but config.toml exposes
-- schemas = ["public"], so every underlying table was a parallel,
-- unguarded read path through PostgREST.
--
-- Two rules this migration establishes and later migrations must keep:
--   1. A client may never SET a column that grants privilege to itself
--      (role, verification_status, status, decided_by). Those move only
--      through SECURITY DEFINER routines or an admin.
--   2. A table-level policy must be at least as strict as the RPC that
--      reads the same rows. If they disagree, the table wins, because
--      the table is directly queryable.
-- ============================================================

-- ---------- H6: extensions on the search_path -----------------
-- On hosted Supabase, PostGIS/ltree/unaccent live in `extensions`.
-- Pinning search_path = public (correct, to block hijack) excluded them
-- and would break <@, st_intersects and unaccent at runtime.

alter function has_role_at_or_above(uuid, member_role) set search_path = public, extensions;
alter function is_verified_member(uuid)                set search_path = public, extensions;
alter function household_card(uuid)                    set search_path = public, extensions;
alter function visible_households(
  uuid, double precision, double precision, double precision, double precision
) set search_path = public, extensions;
alter function touch_updated_at()                      set search_path = public;

-- Dead code: every policy calls auth.uid() directly. A second, ungoverned
-- identity accessor is a liability, not a convenience.
drop function if exists current_profile_id();

-- ---------- C3: communities.path must be derived --------------
-- path was client-writable with no link to parent_id, so an attacker
-- could insert a community whose path forged ancestry over a real one
-- and inherit owner rights across the whole subtree.

alter table communities
  add constraint communities_slug_ltree_safe check (slug ~ '^[a-z0-9_]{1,255}$');

create or replace function communities_derive_path()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare parent_path ltree;
begin
  if new.parent_id is null then
    new.path := new.slug::ltree;
  else
    select c.path into strict parent_path from communities c where c.id = new.parent_id;
    new.path := parent_path || new.slug::ltree;
  end if;
  return new;
end;
$$;

create trigger communities_path_derive
  before insert or update of parent_id, slug on communities
  for each row execute function communities_derive_path();

create unique index communities_path_unique on communities (path);

-- Re-parenting would strand descendant paths. Forbidden until a
-- recursive re-path routine exists (Phase 4).
create or replace function communities_block_reparent()
returns trigger language plpgsql as $$
begin
  if new.parent_id is distinct from old.parent_id then
    raise exception 'community re-parenting is not supported'
      using errcode = '0A000';
  end if;
  return new;
end;
$$;

create trigger communities_no_reparent
  before update on communities
  for each row execute function communities_block_reparent();

-- No client-side community creation. Creation consumes an approved
-- community_requests row inside a SECURITY DEFINER RPC (Phase 4).
drop policy communities_insert on communities;

-- M5: a rejected applicant must not retain read on a private community.
drop policy communities_read on communities;
create policy communities_read on communities
  for select using (
    visibility = 'public'
    or is_verified_member(id)
    or exists (
      select 1 from memberships m
      where m.community_id = communities.id
        and m.profile_id = auth.uid()
        and m.verification_status in ('pending', 'verified')
    )
  );

-- ---------- C1 + C2: membership self-grant --------------------
-- A client could POST or PATCH itself to verified/owner in any
-- community. This was the single highest-severity hole: it manufactured
-- exactly the identity the privacy RPCs are built to serve.

drop policy memberships_self_insert on memberships;
create policy memberships_self_insert on memberships
  for insert with check (
    profile_id = auth.uid()
    and role = 'resident'
    and verification_status = 'unverified'
    and verified_at is null
    and verified_by is null
    and household_id is null
  );

-- A WITH CHECK expression cannot reference OLD, so "role must not
-- change" is inexpressible as a policy. It needs a trigger.
create or replace function memberships_guard_privileged_columns()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if new.role                is distinct from old.role
     or new.verification_status is distinct from old.verification_status
     or new.verified_at         is distinct from old.verified_at
     or new.verified_by         is distinct from old.verified_by
     or new.community_id        is distinct from old.community_id
     or new.profile_id          is distinct from old.profile_id
     or new.household_id        is distinct from old.household_id
  then
    if not has_role_at_or_above(old.community_id, 'admin') then
      raise exception 'not authorized to modify privileged membership columns'
        using errcode = '42501';
    end if;
    -- M2: an admin may not promote themselves toward owner.
    if new.profile_id = auth.uid()
       and role_rank(new.role) > role_rank(old.role) then
      raise exception 'self-promotion is not permitted'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger memberships_guard
  before update on memberships
  for each row execute function memberships_guard_privileged_columns();

-- H1: show_in_directory must sever the person -> address mapping.
drop policy memberships_read on memberships;
create policy memberships_read on memberships
  for select using (
    profile_id = auth.uid()
    or has_role_at_or_above(community_id, 'moderator')
    or (verification_status = 'verified'
        and show_in_directory
        and is_verified_member(community_id))
  );

-- ---------- M1: directory scope is per-community --------------
-- DECISION: membership in a parent does NOT grant directory access to a
-- child. A verified member of an umbrella HOA should not automatically
-- read every constituent street's contact list. Admin/moderator
-- oversight still inherits downward via has_role_at_or_above().

create or replace function is_verified_member(target_community uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1 from memberships m
    where m.profile_id = auth.uid()
      and m.community_id = target_community
      and m.verification_status = 'verified'
  ) or has_role_at_or_above(target_community, 'moderator');
$$;

-- ---------- C4: households -----------------------------------
-- The map opt-out suppressed the pin inside the RPC only; the table
-- returned the address anyway. Bring the table into agreement.

drop policy households_read on households;
create policy households_read on households
  for select using (
    is_verified_member(community_id)
    and status = 'active'
    and (
      exists (select 1 from household_members hm
              where hm.household_id = households.id
                and hm.profile_id = auth.uid())
      or has_role_at_or_above(community_id, 'admin')
      or exists (
        select 1
        from household_members hm
        join memberships mm on mm.profile_id = hm.profile_id
                           and mm.community_id = households.community_id
        where hm.household_id = households.id
          and hm.moved_out_at is null
          and mm.verification_status = 'verified'
          and mm.show_on_map
      )
    )
  );

-- H2: the omitted WITH CHECK defaulted to USING, which keys on id and
-- so constrained nothing else. A resident could move their household to
-- another community, deactivate it, or desync normalized_key.
drop policy households_resident_update on households;
create policy households_resident_update on households
  for update using (
    exists (select 1 from household_members hm
            where hm.household_id = households.id
              and hm.profile_id = auth.uid()
              and hm.moved_out_at is null)
  )
  with check (
    exists (select 1 from household_members hm
            where hm.household_id = households.id
              and hm.profile_id = auth.uid()
              and hm.moved_out_at is null)
  );

create or replace function households_guard_privileged_columns()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if (new.community_id  is distinct from old.community_id
      or new.status     is distinct from old.status
      or new.merged_into_id is distinct from old.merged_into_id)
     and not has_role_at_or_above(old.community_id, 'admin')
  then
    raise exception 'not authorized to modify privileged household columns'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger households_guard
  before update on households
  for each row execute function households_guard_privileged_columns();

-- ---------- M3: normalized_key is derived, not asserted -------
-- unaccent(text) is STABLE, so the IMMUTABLE label was unsound and the
-- column could be desynced from the address. The two-arg form IS
-- immutable, which makes a generated column legal.

create or replace function normalize_address_key(line1 text, unit text default null)
returns text
language sql
immutable
parallel safe
set search_path = public, extensions
as $$
  select trim(both '-' from regexp_replace(
    lower(unaccent('unaccent'::regdictionary,
      coalesce(line1, '') ||
      case when coalesce(unit, '') = '' then '' else ' ' || unit end)),
    '[^a-z0-9]+', '-', 'g'));
$$;

alter table households drop constraint households_key_unique_per_community;
alter table households drop column normalized_key;
alter table households add column normalized_key text
  generated always as (normalize_address_key(address_line1, unit)) stored;
alter table households add constraint households_key_unique_per_community
  unique (community_id, normalized_key);

-- ---------- C5 + C6: household_members ------------------------
-- Read leaked unlisted members (children) and rejected applicants.
-- Write let anyone attach themselves to a neighbor's household and
-- thereby inherit edit rights on that address.

drop policy household_members_read on household_members;
create policy household_members_read on household_members
  for select using (
    profile_id = auth.uid()
    or exists (
      select 1 from households h
      where h.id = household_members.household_id
        and has_role_at_or_above(h.community_id, 'admin')
    )
    or exists (
      select 1
      from households h
      join memberships mm on mm.profile_id = household_members.profile_id
                         and mm.community_id = h.community_id
      where h.id = household_members.household_id
        and is_verified_member(h.community_id)
        and household_members.is_listed
        and household_members.moved_out_at is null
        and mm.verification_status = 'verified'
        and mm.show_in_directory
    )
  );

-- Self-service may SEVER a household link, never CREATE one. Creation
-- belongs to the invite / join-request RPC (Phase 3).
drop policy household_members_self_write on household_members;

create policy household_members_self_update on household_members
  for update using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

create policy household_members_self_delete on household_members
  for delete using (profile_id = auth.uid());

create or replace function household_members_guard()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare community uuid;
begin
  select h.community_id into community from households h where h.id = old.household_id;
  if new.household_id is distinct from old.household_id
     or new.profile_id is distinct from old.profile_id
  then
    if not has_role_at_or_above(community, 'admin') then
      raise exception 'not authorized to reassign household membership'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger household_members_guard_trg
  before update on household_members
  for each row execute function household_members_guard();

-- ---------- H3: service listings cannot self-approve ----------
-- FOR ALL with an unpinned `status` let an author publish straight past
-- moderation and flip their household pin to the service marker.

drop policy services_author_write on services;

create policy services_author_insert on services
  for insert with check (
    profile_id = auth.uid()
    and is_verified_member(community_id)
    and status = 'pending'
    and decided_by is null
    and decided_at is null
  );

create policy services_author_update on services
  for update using (profile_id = auth.uid())
  with check (profile_id = auth.uid() and is_verified_member(community_id));

create policy services_author_delete on services
  for delete using (profile_id = auth.uid());

-- An author edit re-enters moderation rather than riding the old approval.
create or replace function services_guard()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not has_role_at_or_above(old.community_id, 'moderator') then
    if new.status is distinct from old.status
       or new.decided_by is distinct from old.decided_by
       or new.decided_at is distinct from old.decided_at then
      raise exception 'not authorized to set listing status'
        using errcode = '42501';
    end if;
    if new.title is distinct from old.title
       or new.description is distinct from old.description
       or new.category is distinct from old.category then
      new.status := 'pending';
      new.decided_by := null;
      new.decided_at := null;
    end if;
  end if;
  return new;
end;
$$;

create trigger services_guard_trg
  before update on services
  for each row execute function services_guard();

-- ---------- H4: requests cannot self-approve ------------------
-- Critical to close BEFORE the verification RPC is built, since that
-- RPC will trust an approved join_request as proof of admission.

drop policy join_requests_self on join_requests;

create policy join_requests_select_self on join_requests
  for select using (profile_id = auth.uid());

create policy join_requests_insert_self on join_requests
  for insert with check (
    profile_id = auth.uid() and status = 'pending'
    and decided_by is null and decided_at is null
  );

create policy join_requests_withdraw_self on join_requests
  for update using (profile_id = auth.uid() and status = 'pending')
  with check (
    profile_id = auth.uid()
    and status in ('pending', 'withdrawn')
    and decided_by is null
  );

drop policy community_requests_self on community_requests;

create policy community_requests_select_self on community_requests
  for select using (requester_id = auth.uid());

create policy community_requests_insert_self on community_requests
  for insert with check (
    requester_id = auth.uid() and status = 'pending'
    and decided_by is null and decided_at is null and created_community_id is null
  );

create policy community_requests_withdraw_self on community_requests
  for update using (requester_id = auth.uid() and status = 'pending')
  with check (
    requester_id = auth.uid()
    and status in ('pending', 'withdrawn')
    and decided_by is null
  );

-- M5: invite redemption is an RPC, not a client insert. Without this a
-- client could redeem a revoked, expired or exhausted invite.
drop policy invite_redemptions_self on invite_redemptions;
create policy invite_redemptions_read_self on invite_redemptions
  for select using (profile_id = auth.uid());

-- ---------- household_card honors the map opt-out -------------
-- C4, second half: the card RPC checked verification but not
-- show_on_map, so an opted-out address still yielded a full card.

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
    and is_verified_member(h.community_id)
    and (
      -- a resident always reaches their own household
      exists (select 1 from household_members hm3
              where hm3.household_id = h.id and hm3.profile_id = auth.uid())
      or has_role_at_or_above(h.community_id, 'admin')
      or exists (
        select 1
        from household_members hm4
        join memberships mm4 on mm4.profile_id = hm4.profile_id
                            and mm4.community_id = h.community_id
        where hm4.household_id = h.id
          and hm4.moved_out_at is null
          and mm4.verification_status = 'verified'
          and mm4.show_on_map
      )
    );
$$;

-- ---------- M4: the audit trail actually writes ---------------
-- The policy claimed rows were written by definer routines; no such
-- routine existed, so audit_log would have stayed permanently empty.
-- Contact fields are never copied into diff (see the redaction rule).

create or replace function log_audit(
  p_community uuid,
  p_action text,
  p_target_type text,
  p_target_id uuid,
  p_diff jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  insert into audit_log (community_id, actor_id, action, target_type, target_id, diff)
  values (
    p_community, auth.uid(), p_action, p_target_type, p_target_id,
    p_diff - 'phone' - 'email' - 'raw_phone' - 'raw_email'
  );
end;
$$;

create or replace function audit_membership_changes()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if tg_op = 'UPDATE' and (
       new.role is distinct from old.role
       or new.verification_status is distinct from old.verification_status
     ) then
    insert into audit_log (community_id, actor_id, action, target_type, target_id, diff)
    values (
      new.community_id, auth.uid(), 'membership.update', 'membership', new.id,
      jsonb_build_object(
        'role', jsonb_build_object('from', old.role, 'to', new.role),
        'verification_status',
          jsonb_build_object('from', old.verification_status, 'to', new.verification_status)
      )
    );
  end if;
  return new;
end;
$$;

create trigger memberships_audit
  after update on memberships
  for each row execute function audit_membership_changes();

-- ---------- H5: privileges that survive future migrations -----
-- REVOKE ... ON ALL TABLES is a one-shot over tables existing at the
-- time. Supabase's default privileges hand the next new table back to
-- anon, so migration 4 would silently undo migration 2.

alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from public, anon;

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from public, anon;

-- C4: `notes` is where admins record "renter", "kids home alone after
-- 3pm". It must not be column-readable by members. Admin access to it
-- comes through an RPC in Phase 5.
revoke select on households from authenticated;
grant select (id, community_id, address_line1, unit, city, state,
              postal_code, geo, photo_path, status, created_at, updated_at)
  on households to authenticated;

revoke update on households from authenticated;
grant update (address_line1, unit, city, state, postal_code, geo, photo_path)
  on households to authenticated;

revoke update on memberships from authenticated;
grant update (phone_vis, email_vis, show_on_map, show_in_directory)
  on memberships to authenticated;

-- Re-grant the intended entrypoints.
grant execute on function has_role_at_or_above(uuid, member_role) to authenticated;
grant execute on function is_verified_member(uuid)                to authenticated;
grant execute on function normalize_address_key(text, text)       to authenticated;
grant execute on function household_card(uuid)                    to authenticated;
grant execute on function visible_households(
  uuid, double precision, double precision, double precision, double precision
) to authenticated;

-- Cheap insurance for anything that ever runs as the table owner.
do $$
declare t text;
begin
  foreach t in array array[
    'profiles','communities','households','household_members','memberships',
    'invites','invite_redemptions','join_requests','community_requests',
    'announcements','events','service_categories','services','reports',
    'notifications','audit_log'
  ] loop
    execute format('alter table %I force row level security', t);
  end loop;
end;
$$;
