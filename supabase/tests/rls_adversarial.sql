-- ============================================================
-- Front Porch — adversarial RLS test
--
-- Plays the attacker from the Phase 0 security review.
--
-- Each attack runs inside a plpgsql sub-block with an exception handler.
-- That matters: a blocked attack can surface EITHER as zero rows written
-- (RLS policy refused) OR as insufficient_privilege (column/table grant
-- refused). Both are the defense working. Without the handler the first
-- privilege error aborts the transaction and every later case reports a
-- meaningless cascade failure.
--
-- Run:  docker exec -i supabase_db_Community-directory \
--         psql -U postgres -d postgres < supabase/tests/rls_adversarial.sql
--
-- A FAIL here is a privacy incident in production. Build break, not a warning.
-- ============================================================

\set QUIET on
set client_min_messages to notice;
begin;

-- ---------- fixtures ------------------------------------------

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values
 ('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','victim@x.test','x',now(),now(),now()),
 ('22222222-2222-2222-2222-222222222222','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','attacker@x.test','x',now(),now(),now()),
 ('33333333-3333-3333-3333-333333333333','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','neighbor@x.test','x',now(),now(),now());

insert into profiles (id, full_name, email, phone) values
 ('11111111-1111-1111-1111-111111111111','Victim Resident','victim@x.test','+15550001111'),
 ('22222222-2222-2222-2222-222222222222','Mallory Attacker','attacker@x.test','+15550002222'),
 ('33333333-3333-3333-3333-333333333333','Nosy Neighbor','neighbor@x.test','+15550003333');

-- `path` values below are deliberately wrong; the derive trigger overwrites them.
insert into communities (id, parent_id, path, name, slug, visibility, owner_id) values
 ('aaaaaaaa-0000-0000-0000-000000000001', null,
  'wrong','Maple Grove HOA','maple','public','11111111-1111-1111-1111-111111111111'),
 ('aaaaaaaa-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001',
  'wrong','Oakwood','oakwood','private','11111111-1111-1111-1111-111111111111');

insert into households (id, community_id, address_line1, city, state, postal_code, geo, notes) values
 ('bbbbbbbb-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001',
  '2640 Flintgrove Rd','Charlotte','NC','28269',
  st_point(-80.8431,35.2271)::geography,'renter; kids home alone after 3pm'),
 ('bbbbbbbb-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001',
  '14 Oak Lane','Charlotte','NC','28269',
  st_point(-80.8440,35.2280)::geography,null);

-- Victim: verified, but opted OUT of the map and the directory.
insert into memberships (community_id, profile_id, household_id, role,
                         verification_status, show_on_map, show_in_directory)
values ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
        'bbbbbbbb-0000-0000-0000-000000000002','resident','verified', false, false);

-- Neighbour: verified and visible, owns the Flintgrove household.
insert into memberships (community_id, profile_id, household_id, role, verification_status)
values ('aaaaaaaa-0000-0000-0000-000000000001','33333333-3333-3333-3333-333333333333',
        'bbbbbbbb-0000-0000-0000-000000000001','resident','verified');

insert into household_members (household_id, profile_id, relationship, is_primary, is_listed) values
 ('bbbbbbbb-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','owner',true,true),
 ('bbbbbbbb-0000-0000-0000-000000000001','33333333-3333-3333-3333-333333333333','owner',true,true);

insert into service_categories (slug,label) values ('pet_care','Pet Care') on conflict (slug) do nothing;

\set QUIET off

-- ---------- structural checks (as postgres) -------------------

do $$
begin
  raise notice '%  C3a  community path derived from parent, client value ignored',
    case when (select path::text from communities where slug='oakwood') = 'maple.oakwood'
         then 'PASS' else 'FAIL' end;

  raise notice '%  INV4 roles inherit downward only, never upward',
    case when ('maple.oakwood'::ltree <@ 'maple'::ltree)
          and not ('maple'::ltree <@ 'maple.oakwood'::ltree)
         then 'PASS' else 'FAIL' end;

  raise notice '%  C4   admin notes column is not grantable to members',
    case when not exists (
      select 1 from information_schema.column_privileges
      where grantee='authenticated' and table_name='households'
        and column_name='notes' and privilege_type='SELECT')
    then 'PASS' else 'FAIL' end;
end $$;

-- ============ THE ATTACKER: unverified, uninvited ============

set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

do $$
declare blocked boolean := false;
begin
  begin
    insert into memberships (community_id, profile_id, role, verification_status)
    values ('aaaaaaaa-0000-0000-0000-000000000001',
            '22222222-2222-2222-2222-222222222222','owner','verified');
  exception when others then blocked := true;
  end;
  if not blocked then
    blocked := not exists (select 1 from memberships
      where profile_id='22222222-2222-2222-2222-222222222222' and role='owner');
  end if;
  raise notice '%  C1   cannot self-grant a verified owner membership',
    case when blocked then 'PASS' else 'FAIL' end;
end $$;

do $$
declare ok boolean := false;
begin
  begin
    insert into memberships (community_id, profile_id)
    values ('aaaaaaaa-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222');
    ok := exists (select 1 from memberships
      where profile_id='22222222-2222-2222-2222-222222222222'
        and role='resident' and verification_status='unverified');
  exception when others then ok := false;
  end;
  raise notice '%  C1b  legitimate signup lands unverified/resident',
    case when ok then 'PASS' else 'FAIL' end;
end $$;

do $$
declare blocked boolean := false;
begin
  begin
    update memberships set role='owner', verification_status='verified'
    where profile_id='22222222-2222-2222-2222-222222222222';
  exception when others then blocked := true;
  end;
  if not blocked then
    blocked := not exists (select 1 from memberships
      where profile_id='22222222-2222-2222-2222-222222222222'
        and verification_status='verified');
  end if;
  raise notice '%  C2   cannot escalate own role or self-verify',
    case when blocked then 'PASS' else 'FAIL' end;
end $$;

do $$
declare ok boolean := false;
begin
  begin
    update memberships set show_on_map=false, phone_vis='hidden'
    where profile_id='22222222-2222-2222-2222-222222222222';
    ok := exists (select 1 from memberships
      where profile_id='22222222-2222-2222-2222-222222222222' and phone_vis='hidden');
  exception when others then ok := false;
  end;
  raise notice '%  C2b  CAN always turn own visibility down',
    case when ok then 'PASS' else 'FAIL' end;
end $$;

do $$
declare blocked boolean := false;
begin
  begin
    insert into communities (parent_id, path, name, slug, visibility, owner_id)
    values (null,'maple','Evil Twin','eviltwin','private',
            '22222222-2222-2222-2222-222222222222');
  exception when others then blocked := true;
  end;
  if not blocked then
    blocked := not exists (select 1 from communities where slug='eviltwin');
  end if;
  raise notice '%  C3b  cannot forge a community with an ancestor path',
    case when blocked then 'PASS' else 'FAIL' end;
end $$;

do $$
declare blocked boolean := false;
begin
  begin
    insert into household_members (household_id, profile_id, relationship)
    values ('bbbbbbbb-0000-0000-0000-000000000001',
            '22222222-2222-2222-2222-222222222222','member');
  exception when others then blocked := true;
  end;
  if not blocked then
    blocked := not exists (select 1 from household_members
      where profile_id='22222222-2222-2222-2222-222222222222');
  end if;
  raise notice '%  C6   cannot attach self to a neighbour household',
    case when blocked then 'PASS' else 'FAIL' end;
end $$;

-- What can the unverified attacker actually see?
do $$
declare n int;
begin
  select count(*) into n from households;
  raise notice '%  INV1 unverified member sees no households (% rows)',
    case when n=0 then 'PASS' else 'FAIL' end, n;

  raise notice '%  INV1 unverified member gets no household card',
    case when household_card('bbbbbbbb-0000-0000-0000-000000000001') is null
         then 'PASS' else 'FAIL' end;

  select count(*) into n from profiles;
  raise notice '%  INV2 cannot read other people''s profile rows (% visible)',
    case when n<=1 then 'PASS' else 'FAIL' end, n;

  select count(*) into n from household_members;
  raise notice '%  C5   unverified member cannot enumerate residents (% rows)',
    case when n=0 then 'PASS' else 'FAIL' end, n;
end $$;

-- ============ A VERIFIED NEIGHBOUR ============
-- Legitimate member, so the RPCs should serve them — but the victim
-- opted out of both the map and the directory.

set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

do $$
declare n int; card jsonb;
begin
  raise notice '%  SANITY verified member is recognised',
    case when is_verified_member('aaaaaaaa-0000-0000-0000-000000000001')
         then 'PASS' else 'FAIL' end;

  n := jsonb_array_length(visible_households(
        'aaaaaaaa-0000-0000-0000-000000000001',-81.0,35.0,-80.0,36.0) -> 'features');
  raise notice '%  INV3 map returns only the opted-IN household (% pins)',
    case when n=1 then 'PASS' else 'FAIL' end, n;

  raise notice '%  INV3 opted-out household yields no card to a verified neighbour',
    case when household_card('bbbbbbbb-0000-0000-0000-000000000002') is null
         then 'PASS' else 'FAIL' end;

  select count(*) into n from households;
  raise notice '%  INV3 opted-out household is not table-readable either (% rows)',
    case when n=1 then 'PASS' else 'FAIL' end, n;

  card := household_card('bbbbbbbb-0000-0000-0000-000000000001');
  raise notice '%  SANITY own household card returns its members',
    case when jsonb_array_length(card -> 'members') = 1 then 'PASS' else 'FAIL' end;

  raise notice '%  INV2 default phone setting is text-only, not callable',
    case when (card -> 'members' -> 0 -> 'phone' ->> 'can_call') = 'false'
         then 'PASS' else 'FAIL' end;

  select count(*) into n from household_members;
  raise notice '%  C5   directory opt-out hides the victim from resident lists (% rows)',
    case when n=1 then 'PASS' else 'FAIL' end, n;
end $$;

do $$
declare blocked boolean := false;
begin
  begin
    insert into services (community_id, profile_id, household_id, category, title, status)
    values ('aaaaaaaa-0000-0000-0000-000000000001','33333333-3333-3333-3333-333333333333',
            'bbbbbbbb-0000-0000-0000-000000000001','pet_care','Dog walking','approved');
  exception when others then blocked := true;
  end;
  if not blocked then
    blocked := not exists (select 1 from services where status='approved');
  end if;
  raise notice '%  H3   author cannot publish a listing past moderation',
    case when blocked then 'PASS' else 'FAIL' end;
end $$;

do $$
declare blocked boolean := false;
begin
  begin
    insert into join_requests (community_id, profile_id, claimed_address, note)
    values ('aaaaaaaa-0000-0000-0000-000000000001',
            '33333333-3333-3333-3333-333333333333','14 Oak Lane','let me in');
    update join_requests set status='approved'
    where profile_id='33333333-3333-3333-3333-333333333333';
  exception when others then blocked := true;
  end;
  if not blocked then
    blocked := not exists (select 1 from join_requests where status='approved');
  end if;
  raise notice '%  H4   requester cannot approve their own join request',
    case when blocked then 'PASS' else 'FAIL' end;
end $$;

rollback;
