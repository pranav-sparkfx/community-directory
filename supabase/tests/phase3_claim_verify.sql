-- ============================================================
-- Front Porch — Phase 3: claim an address, get verified.
--
-- This walks the whole residency chain as the actual Postgres roles,
-- with the same exception-handler discipline as the adversarial suite: a
-- correct refusal can arrive as zero rows OR as a raised exception, and
-- both count.
--
-- Run:  docker exec -i supabase_db_Community-directory \
--         psql -U postgres -d postgres < supabase/tests/phase3_claim_verify.sql
-- ============================================================

\set QUIET on
set client_min_messages to notice;
begin;

-- Seeded fixtures. Wesley is the community owner; Summerlake is private.
\set summerlake '5eed0000-0000-4000-8000-000000000001'
\set owner_id   '11110000-0000-4000-8000-000000000001'

-- A brand-new person with no membership anywhere.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        confirmation_token, recovery_token, email_change_token_new,
                        email_change, email_change_token_current, phone_change,
                        phone_change_token, reauthentication_token)
values ('99999999-9999-4999-8999-999999999999',
        '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'nadia@newcomer.test', 'x', now(), now(), now(),
        '', '', '', '', '', '', '', '');

insert into profiles (id, full_name, email, phone)
values ('99999999-9999-4999-8999-999999999999', 'Nadia Newcomer',
        'nadia@newcomer.test', '+15550009999');

do $$ begin raise notice '--- Phase 3: claim and verify ---'; end $$;

-- ---------- 1. a stranger cannot enumerate a private community ----------
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"99999999-9999-4999-8999-999999999999","role":"authenticated"}';

do $$
declare n int;
begin
  select count(*) into n
  from claimable_addresses('5eed0000-0000-4000-8000-000000000001', 'Heron');
  if n = 0 then
    raise notice 'PASS 1  private community address list is not enumerable by a stranger';
  else
    raise notice 'FAIL 1  stranger read % addresses from a private community', n;
  end if;
exception when others then
  raise notice 'PASS 1  refused (%)', sqlerrm;
end $$;

-- ---------- 2. she can still ask, in her own words ----------
do $$
declare rid uuid;
begin
  rid := submit_join_request(
    '5eed0000-0000-4000-8000-000000000001', null,
    '1404 Heron Ridge', 'We closed on the house last Tuesday.');
  if rid is null then
    raise notice 'FAIL 2  submit_join_request returned null';
  else
    raise notice 'PASS 2  claim submitted (%)', rid;
  end if;
exception when others then
  raise notice 'FAIL 2  claim refused: %', sqlerrm;
end $$;

-- ---------- 3. pending is not verified ----------
do $$
declare st verification_status; n int;
begin
  select verification_status into st from memberships
  where profile_id = '99999999-9999-4999-8999-999999999999';

  select jsonb_array_length(
    (visible_households('5eed0000-0000-4000-8000-000000000001')->'features')) into n;

  if st = 'pending' and n = 0 then
    raise notice 'PASS 3  status=pending and the map is still empty to her';
  else
    raise notice 'FAIL 3  status=% and she can see % pins', st, n;
  end if;
end $$;

-- ---------- 4. she cannot approve herself ----------
do $$
declare rid uuid;
begin
  select id into rid from join_requests
  where profile_id = '99999999-9999-4999-8999-999999999999' and status = 'pending';
  perform decide_join_request(rid, true, 'me again');
  raise notice 'FAIL 4  applicant approved her own claim';
exception when others then
  raise notice 'PASS 4  self-approval refused (%)', sqlerrm;
end $$;

-- ---------- 5. nor can she match her claim to a house ----------
do $$
declare rid uuid; hh uuid;
begin
  select id into rid from join_requests
  where profile_id = '99999999-9999-4999-8999-999999999999' and status = 'pending';
  select id into hh from households
  where community_id = '5eed0000-0000-4000-8000-000000000001' limit 1;
  perform match_join_request(rid, hh);
  raise notice 'FAIL 5  applicant matched her own claim to a pin';
exception when others then
  raise notice 'PASS 5  self-match refused (%)', sqlerrm;
end $$;

-- ---------- 6. the admin sees her in the queue, with her words ----------
reset role;
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"11110000-0000-4000-8000-000000000001","role":"authenticated"}';

do $$
declare q jsonb; row jsonb;
begin
  q := verification_queue('5eed0000-0000-4000-8000-000000000001');
  select value into row from jsonb_array_elements(q) value
  where value->>'profile_id' = '99999999-9999-4999-8999-999999999999';

  if row is null then
    raise notice 'FAIL 6  applicant absent from the admin queue';
  elsif row->>'name' = 'Nadia Newcomer'
        and row->>'claimed_address' = '1404 Heron Ridge'
        and (row->>'address_is_known')::boolean = false then
    raise notice 'PASS 6  queue shows the name, the typed address, and that it is unmatched';
  else
    raise notice 'FAIL 6  queue row wrong: %', row;
  end if;
end $$;

-- ---------- 7. approval is refused while the address is prose ----------
do $$
declare rid uuid;
begin
  select id into rid from join_requests
  where profile_id = '99999999-9999-4999-8999-999999999999' and status = 'pending';
  perform decide_join_request(rid, true, null);
  raise notice 'FAIL 7  approved a claim that was never matched to a pin';
exception when others then
  raise notice 'PASS 7  unmatched claim cannot be approved (%)', sqlerrm;
end $$;

-- ---------- 8. match, then approve ----------
do $$
declare rid uuid; hh uuid;
begin
  select id into rid from join_requests
  where profile_id = '99999999-9999-4999-8999-999999999999' and status = 'pending';
  select id into hh from households
  where community_id = '5eed0000-0000-4000-8000-000000000001'
    and address_line1 = '1404 Heron Ridge';
  if hh is null then
    raise notice 'SKIP 8  seed has no 1404 Heron Ridge';
    return;
  end if;
  perform match_join_request(rid, hh);
  perform decide_join_request(rid, true, null, 'owner');
  raise notice 'PASS 8  matched and approved';
exception when others then
  raise notice 'FAIL 8  %', sqlerrm;
end $$;

-- ---------- 9. she is now a resident, with the address attached ----------
do $$
declare st verification_status; hh uuid; nm int;
begin
  select verification_status, household_id into st, hh from memberships
  where profile_id = '99999999-9999-4999-8999-999999999999';
  select count(*) into nm from household_members
  where profile_id = '99999999-9999-4999-8999-999999999999';

  if st = 'verified' and hh is not null and nm = 1 then
    raise notice 'PASS 9  verified, address attached, listed on the household';
  else
    raise notice 'FAIL 9  status=% household=% member_rows=%', st, hh, nm;
  end if;
end $$;

-- ---------- 10. and the map opens to her ----------
reset role;
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"99999999-9999-4999-8999-999999999999","role":"authenticated"}';

do $$
declare n int; a int;
begin
  select jsonb_array_length(
    (visible_households('5eed0000-0000-4000-8000-000000000001')->'features')) into n;
  select count(*) into a
  from claimable_addresses('5eed0000-0000-4000-8000-000000000001', 'Heron');

  if n > 100 and a > 0 then
    raise notice 'PASS 10 the directory opened (% pins) once she was verified', n;
  else
    raise notice 'FAIL 10 pins=% addresses=%', n, a;
  end if;
end $$;

-- ---------- 11. privacy is hers to change, role is not ----------
do $$
begin
  update memberships set phone_vis = 'hidden', show_on_map = false
  where profile_id = '99999999-9999-4999-8999-999999999999';
  raise notice 'PASS 11 resident may change her own privacy settings';
exception when others then
  raise notice 'FAIL 11 privacy update refused: %', sqlerrm;
end $$;

do $$
begin
  update memberships set role = 'admin'
  where profile_id = '99999999-9999-4999-8999-999999999999';
  raise notice 'FAIL 11b resident promoted herself to admin';
exception when others then
  raise notice 'PASS 11b self-promotion still refused (%)', sqlerrm;
end $$;

-- ---------- 12. she is named at exactly one address ----------
-- Regression: approving a claim used to leave the claimant listed at any
-- address they already held, so a neighbour looking at the old home still
-- saw someone who had moved out.
do $$
declare listed int;
begin
  select count(*) into listed
  from household_members hm
  join households h on h.id = hm.household_id
  where hm.profile_id = '99999999-9999-4999-8999-999999999999'
    and h.community_id = '5eed0000-0000-4000-8000-000000000001'
    and hm.moved_out_at is null;

  if listed = 1 then
    raise notice 'PASS 12 named at exactly one address in this community';
  else
    raise notice 'FAIL 12 named at % addresses', listed;
  end if;
end $$;

-- ---------- 13. a second claim retires the first address ----------
do $$
declare rid uuid; hh uuid; old_out date; new_live int;
begin
  rid := submit_join_request(
    '5eed0000-0000-4000-8000-000000000001', null, '1406 Heron Ridge', 'We moved down the street.');

  reset role;
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"11110000-0000-4000-8000-000000000001","role":"authenticated"}';

  select id into hh from households
  where community_id = '5eed0000-0000-4000-8000-000000000001'
    and address_line1 = '1406 Heron Ridge';
  perform match_join_request(rid, hh);
  perform decide_join_request(rid, true, null, 'owner');

  select hm.moved_out_at into old_out
  from household_members hm join households h on h.id = hm.household_id
  where hm.profile_id = '99999999-9999-4999-8999-999999999999'
    and h.address_line1 = '1404 Heron Ridge';

  select count(*) into new_live
  from household_members hm join households h on h.id = hm.household_id
  where hm.profile_id = '99999999-9999-4999-8999-999999999999'
    and h.community_id = '5eed0000-0000-4000-8000-000000000001'
    and hm.moved_out_at is null;

  if old_out is not null and new_live = 1 then
    raise notice 'PASS 13 the old address was retired, the new one is the only live listing';
  else
    raise notice 'FAIL 13 old moved_out_at=% live_listings=%', old_out, new_live;
  end if;
exception when others then
  raise notice 'FAIL 13 %', sqlerrm;
end $$;

reset role;
rollback;
