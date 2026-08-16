-- ============================================================
-- Front Porch — Phase 4: communities, invites, roles, ownership.
--
-- The question this suite exists to answer is "can anyone climb?". Every
-- privileged routine is called by someone one rung too low, and the pass
-- condition is a refusal — arriving either as an exception or as no effect.
--
-- Run:  docker exec -i supabase_db_Community-directory \
--         psql -U postgres -d postgres < supabase/tests/phase4_communities_roles.sql
-- ============================================================

\set QUIET on
set client_min_messages to notice;
begin;

-- Seeded cast:
--   Summerlake      5eed…0001   private, owned by Wesley
--   Willow Run      5eed…0002   a sub-community of it, owned by Claire
--   Wesley Whitfield 1111…0001  owner
--   Kate Trevino     1111…0009  admin
--   Dana Hollis      1111…0014  moderator
--   Ana Moreno       1111…0080  plain verified resident
--
-- Household ids are gen_random_uuid() and are re-minted by every `db reset`,
-- so they are looked up by address at run time and parked in `t`. An earlier
-- draft pinned one as a literal and quietly started failing the morning after
-- the next reset.

do $$ begin raise notice '--- Phase 4: communities, invites, roles ---'; end $$;

-- A newcomer with no membership anywhere, for the invite-redemption path.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        confirmation_token, recovery_token, email_change_token_new,
                        email_change, email_change_token_current, phone_change,
                        phone_change_token, reauthentication_token)
values ('88888888-8888-4888-8888-888888888888',
        '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'ivy@invitee.test', 'x', now(), now(), now(), '', '', '', '', '', '', '', ''),
       ('77777777-7777-4777-8777-777777777777',
        '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'frank@founder.test', 'x', now(), now(), now(), '', '', '', '', '', '', '', '');

insert into profiles (id, full_name, email, phone) values
  ('88888888-8888-4888-8888-888888888888', 'Ivy Invitee', 'ivy@invitee.test', '+15550008888'),
  ('77777777-7777-4777-8777-777777777777', 'Frank Founder', 'frank@founder.test', '+15550007777');

-- Somewhere to park the codes minted mid-suite, since each `do` block is
-- its own scope and psql variables do not reach inside dollar quoting.
-- The grant matters: without it every `set local role authenticated` block
-- fails on the scratch table instead of on the thing under test, and the
-- exception handlers report that as a pass.
create temp table t (k text primary key, v text);
grant all on t to authenticated;

-- ============================================================
-- INVITES
-- ============================================================

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"11110000-0000-4000-8000-000000000014","role":"authenticated"}';

-- ---------- 1. a moderator cannot mint an admin invite ----------
do $$
begin
  perform create_invite('5eed0000-0000-4000-8000-000000000001', 'admin');
  raise notice 'FAIL 1  a moderator minted an admin invite';
exception when others then
  raise notice 'PASS 1  invite above own rank refused (%)', sqlerrm;
end $$;

-- ---------- 2. but a resident invite is their job ----------
do $$
declare r jsonb;
begin
  r := create_invite('5eed0000-0000-4000-8000-000000000001', 'resident', null, null, 5, 30);
  insert into t values ('link_code', r->>'code');
  if r->>'code' is null then
    raise notice 'FAIL 2  no code returned';
  else
    raise notice 'PASS 2  moderator minted a 5-use link invite (%)', r->>'code';
  end if;
exception when others then
  raise notice 'FAIL 2  %', sqlerrm;
end $$;

-- ---------- 3. a plain resident cannot invite at all ----------
reset role;
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"11110000-0000-4000-8000-000000000080","role":"authenticated"}';

do $$
begin
  perform create_invite('5eed0000-0000-4000-8000-000000000001', 'resident');
  raise notice 'FAIL 3  a resident minted an invite';
exception when others then
  raise notice 'PASS 3  resident cannot invite (%)', sqlerrm;
end $$;

-- ---------- 4. an admin may address an invite to one house ----------
reset role;
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"11110000-0000-4000-8000-000000000009","role":"authenticated"}';

do $$
declare r jsonb; hh uuid;
begin
  select id into hh from households
  where community_id = '5eed0000-0000-4000-8000-000000000001'
    and address_line1 = '1400 Heron Ridge';
  insert into t values ('house_id', hh::text);

  r := create_invite('5eed0000-0000-4000-8000-000000000001', 'resident',
                     'ivy@invitee.test', hh, 1, 14);
  insert into t values ('house_code', r->>'code');
  raise notice 'PASS 4  admin minted an address-bound invite';
exception when others then
  raise notice 'FAIL 4  %', sqlerrm;
end $$;

-- ---------- 5. an address-bound invite must be single-use ----------
do $$
begin
  perform create_invite('5eed0000-0000-4000-8000-000000000001', 'resident', null,
                        (select v::uuid from t where k = 'house_id'), 20, 14);
  raise notice 'FAIL 5  a 20-use invite was tied to one address';
exception when others then
  raise notice 'PASS 5  address-bound invite forced single-use (%)', sqlerrm;
end $$;

-- ---------- 6. the wrong person cannot spend an addressed invite ----------
reset role;
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"77777777-7777-4777-8777-777777777777","role":"authenticated"}';

do $$
declare code text;
begin
  select v into code from t where k = 'house_code';
  perform redeem_invite(code);
  raise notice 'FAIL 6  an invite addressed to Ivy was redeemed by Frank';
exception when others then
  raise notice 'PASS 6  email-scoped invite refused a stranger (%)', sqlerrm;
end $$;

-- ---------- 7. the right person is verified on the spot ----------
reset role;
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"88888888-8888-4888-8888-888888888888","role":"authenticated"}';

do $$
declare code text; r jsonb; st verification_status; hh uuid; expected uuid; listed int;
begin
  select v into code from t where k = 'house_code';
  select v::uuid into expected from t where k = 'house_id';
  r := redeem_invite(code);

  select verification_status, household_id into st, hh from memberships
  where profile_id = '88888888-8888-4888-8888-888888888888';
  select count(*) into listed from household_members
  where profile_id = '88888888-8888-4888-8888-888888888888' and moved_out_at is null;

  if (r->>'verified')::boolean and st = 'verified'
     and hh = expected and listed = 1 then
    raise notice 'PASS 7  an admin naming the house IS the verification';
  else
    raise notice 'FAIL 7  verified=% status=% household=% listed=%',
      r->>'verified', st, hh, listed;
  end if;
exception when others then
  raise notice 'FAIL 7  %', sqlerrm;
end $$;

-- ---------- 8. a spent single-use invite is spent ----------
reset role;
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"77777777-7777-4777-8777-777777777777","role":"authenticated"}';

do $$
declare code text;
begin
  select v into code from t where k = 'house_code';
  perform redeem_invite(code);
  raise notice 'FAIL 8  a single-use invite was redeemed twice';
exception when others then
  raise notice 'PASS 8  spent invite refused (%)', sqlerrm;
end $$;

-- ---------- 9. an open link admits you, but not to the directory ----------
do $$
declare code text; r jsonb; st verification_status; pins int;
begin
  select v into code from t where k = 'link_code';
  r := redeem_invite(code);

  select verification_status into st from memberships
  where profile_id = '77777777-7777-4777-8777-777777777777';
  select jsonb_array_length(
    (visible_households('5eed0000-0000-4000-8000-000000000001')->'features')) into pins;

  if st = 'unverified' and pins = 0 then
    raise notice 'PASS 9  a link invite admits you and stops there — still 0 pins';
  else
    raise notice 'FAIL 9  status=% pins=%', st, pins;
  end if;
exception when others then
  raise notice 'FAIL 9  %', sqlerrm;
end $$;

-- ---------- 10. a revoked invite is dead ----------
reset role;
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"11110000-0000-4000-8000-000000000009","role":"authenticated"}';

do $$
declare r jsonb; inv uuid;
begin
  r := create_invite('5eed0000-0000-4000-8000-000000000001', 'resident', null, null, 10, 30);
  insert into t values ('dead_code', r->>'code');
  select id into inv from invites where code = r->>'code';
  perform revoke_invite(inv);
  raise notice 'PASS 10 admin revoked an invite';
exception when others then
  raise notice 'FAIL 10 %', sqlerrm;
end $$;

reset role;
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"11110000-0000-4000-8000-000000000080","role":"authenticated"}';

do $$
declare code text;
begin
  select v into code from t where k = 'dead_code';
  perform redeem_invite(code);
  raise notice 'FAIL 10b a revoked invite still worked';
exception when others then
  raise notice 'PASS 10b revoked invite refused (%)', sqlerrm;
end $$;

-- ============================================================
-- ROLES
-- ============================================================

-- ---------- 11. a resident cannot hand themselves a role ----------
do $$
begin
  perform set_member_role('5eed0000-0000-4000-8000-000000000001',
                          '11110000-0000-4000-8000-000000000080', 'admin');
  raise notice 'FAIL 11 a resident promoted themselves';
exception when others then
  raise notice 'PASS 11 resident cannot set roles (%)', sqlerrm;
end $$;

reset role;
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"11110000-0000-4000-8000-000000000009","role":"authenticated"}';

-- ---------- 12. an admin cannot grant admin ----------
do $$
begin
  perform set_member_role('5eed0000-0000-4000-8000-000000000001',
                          '11110000-0000-4000-8000-000000000080', 'admin');
  raise notice 'FAIL 12 an admin minted a peer';
exception when others then
  raise notice 'PASS 12 no granting at or above your own rank (%)', sqlerrm;
end $$;

-- ---------- 13. an admin cannot demote the owner ----------
do $$
begin
  perform set_member_role('5eed0000-0000-4000-8000-000000000001',
                          '11110000-0000-4000-8000-000000000001', 'resident');
  raise notice 'FAIL 13 an admin demoted the owner';
exception when others then
  raise notice 'PASS 13 the owner out-ranks an admin (%)', sqlerrm;
end $$;

-- ---------- 14. an admin cannot edit their own role ----------
do $$
begin
  perform set_member_role('5eed0000-0000-4000-8000-000000000001',
                          '11110000-0000-4000-8000-000000000009', 'moderator');
  raise notice 'FAIL 14 an admin edited their own role';
exception when others then
  raise notice 'PASS 14 nobody edits their own role (%)', sqlerrm;
end $$;

-- ---------- 15. an admin CAN appoint a moderator ----------
do $$
declare r member_role;
begin
  perform set_member_role('5eed0000-0000-4000-8000-000000000001',
                          '11110000-0000-4000-8000-000000000080', 'moderator');
  select role into r from memberships
  where community_id = '5eed0000-0000-4000-8000-000000000001'
    and profile_id = '11110000-0000-4000-8000-000000000080';
  if r = 'moderator' then
    raise notice 'PASS 15 admin appointed a moderator, and it stuck';
  else
    raise notice 'FAIL 15 role is now %', r;
  end if;
exception when others then
  raise notice 'FAIL 15 %', sqlerrm;
end $$;

-- ---------- 16. the owner is not removable ----------
do $$
begin
  perform remove_member('5eed0000-0000-4000-8000-000000000001',
                        '11110000-0000-4000-8000-000000000001');
  raise notice 'FAIL 16 an admin removed the owner';
exception when others then
  raise notice 'PASS 16 the owner cannot be removed (%)', sqlerrm;
end $$;

-- ---------- 17. removing a member retires the address, never deletes it --
do $$
declare gone int; retired int;
begin
  perform remove_member('5eed0000-0000-4000-8000-000000000001',
                        '88888888-8888-4888-8888-888888888888', 'Sold the house.');

  select count(*) into gone from memberships
  where profile_id = '88888888-8888-4888-8888-888888888888';
  select count(*) into retired from household_members
  where profile_id = '88888888-8888-4888-8888-888888888888'
    and moved_out_at is not null;

  if gone = 0 and retired = 1 then
    raise notice 'PASS 17 membership gone, household history kept as moved-out';
  else
    raise notice 'FAIL 17 memberships=% retired_rows=%', gone, retired;
  end if;
exception when others then
  raise notice 'FAIL 17 %', sqlerrm;
end $$;

-- ============================================================
-- OWNERSHIP
-- ============================================================

-- ---------- 18. an admin cannot write owner_id directly ----------
do $$
begin
  update communities set owner_id = '11110000-0000-4000-8000-000000000009'
  where id = '5eed0000-0000-4000-8000-000000000001';
  raise notice 'FAIL 18 an admin seized ownership with a plain UPDATE';
exception when others then
  raise notice 'PASS 18 owner_id is not client-writable (%)', sqlerrm;
end $$;

-- ---------- 19. nor rewrite the slug the hierarchy is keyed on ----------
do $$
begin
  update communities set slug = 'hijacked'
  where id = '5eed0000-0000-4000-8000-000000000001';
  raise notice 'FAIL 19 an admin rewrote the community slug';
exception when others then
  raise notice 'PASS 19 slug and path are fixed (%)', sqlerrm;
end $$;

-- ---------- 20. an admin CAN flip the community to public ----------
do $$
declare v community_visibility;
begin
  update communities set visibility = 'public'
  where id = '5eed0000-0000-4000-8000-000000000001';
  select visibility into v from communities
  where id = '5eed0000-0000-4000-8000-000000000001';
  if v = 'public' then
    raise notice 'PASS 20 admin set the community public';
  else
    raise notice 'FAIL 20 visibility is %', v;
  end if;
exception when others then
  raise notice 'FAIL 20 %', sqlerrm;
end $$;

-- ---------- 21. an admin cannot transfer what they do not own ----------
do $$
begin
  perform transfer_ownership('5eed0000-0000-4000-8000-000000000001',
                             '11110000-0000-4000-8000-000000000009');
  raise notice 'FAIL 21 an admin transferred the community to themselves';
exception when others then
  raise notice 'PASS 21 only the owner may hand over (%)', sqlerrm;
end $$;

-- ---------- 22. the owner can, and is demoted in the same breath ----------
reset role;
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"11110000-0000-4000-8000-000000000001","role":"authenticated"}';

do $$
declare owners int; new_role member_role; old_role member_role; owner_col uuid;
begin
  perform transfer_ownership('5eed0000-0000-4000-8000-000000000001',
                             '11110000-0000-4000-8000-000000000009');

  select count(*) into owners from memberships
  where community_id = '5eed0000-0000-4000-8000-000000000001' and role = 'owner';
  select role into new_role from memberships
  where community_id = '5eed0000-0000-4000-8000-000000000001'
    and profile_id = '11110000-0000-4000-8000-000000000009';
  select role into old_role from memberships
  where community_id = '5eed0000-0000-4000-8000-000000000001'
    and profile_id = '11110000-0000-4000-8000-000000000001';
  select owner_id into owner_col from communities
  where id = '5eed0000-0000-4000-8000-000000000001';

  if owners = 1 and new_role = 'owner' and old_role = 'admin'
     and owner_col = '11110000-0000-4000-8000-000000000009' then
    raise notice 'PASS 22 exactly one owner, and the columns agree';
  else
    raise notice 'FAIL 22 owners=% new=% old=% owner_col=%',
      owners, new_role, old_role, owner_col;
  end if;
exception when others then
  raise notice 'FAIL 22 %', sqlerrm;
end $$;

-- ============================================================
-- SUB-COMMUNITIES
-- ============================================================

-- ---------- 23. a resident's proposal becomes a request, not a community --
reset role;
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"11110000-0000-4000-8000-000000000016","role":"authenticated"}';

do $$
declare r jsonb;
begin
  r := propose_community('5eed0000-0000-4000-8000-000000000001',
                         'Cedar Bend Court', 'The eight of us on the cul-de-sac.');
  insert into t values ('req_id', r->>'request_id');
  if r->>'status' = 'requested' and r->>'request_id' is not null then
    raise notice 'PASS 23 a resident proposal is queued, not granted';
  else
    raise notice 'FAIL 23 %', r;
  end if;
exception when others then
  raise notice 'FAIL 23 %', sqlerrm;
end $$;

-- ---------- 24. and they cannot approve it themselves ----------
do $$
declare rid uuid;
begin
  select v::uuid into rid from t where k = 'req_id';
  perform decide_community_request(rid, true);
  raise notice 'FAIL 24 the requester approved their own community';
exception when others then
  raise notice 'PASS 24 self-approval refused (%)', sqlerrm;
end $$;

-- ---------- 25. an admin approves, and the requester runs it ----------
reset role;
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"11110000-0000-4000-8000-000000000009","role":"authenticated"}';

do $$
declare rid uuid; r jsonb; new_id uuid; p ltree; owner_role member_role;
begin
  select v::uuid into rid from t where k = 'req_id';
  r := decide_community_request(rid, true);
  new_id := (r->>'community_id')::uuid;

  select path into p from communities where id = new_id;
  select role into owner_role from memberships
  where community_id = new_id and profile_id = '11110000-0000-4000-8000-000000000016';

  if p = 'summerlake.cedar_bend_court'::ltree and owner_role = 'owner' then
    raise notice 'PASS 25 sub-community created at %, requester owns it', p;
  else
    raise notice 'FAIL 25 path=% owner_role=%', p, owner_role;
  end if;
exception when others then
  raise notice 'FAIL 25 %', sqlerrm;
end $$;

-- ---------- 26. an admin may create one outright ----------
do $$
declare r jsonb; p ltree;
begin
  r := propose_community('5eed0000-0000-4000-8000-000000000001', 'Heron Ridge');
  if r->>'status' = 'created' then
    select path into p from communities where id = (r->>'community_id')::uuid;
    raise notice 'PASS 26 admin created a sub-community outright at %', p;
  else
    raise notice 'FAIL 26 %', r;
  end if;
exception when others then
  raise notice 'FAIL 26 %', sqlerrm;
end $$;

-- ---------- 27. a stranger cannot propose inside a community ----------
reset role;
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"77777777-7777-4777-8777-777777777777","role":"authenticated"}';

do $$
begin
  perform propose_community('5eed0000-0000-4000-8000-000000000001', 'Franks Enclave');
  raise notice 'FAIL 27 a non-member proposed a sub-community';
exception when others then
  raise notice 'PASS 27 you must belong somewhere to propose inside it (%)', sqlerrm;
end $$;

-- ---------- 28. but anyone may start a neighbourhood of their own ----------
do $$
declare r jsonb; role_held member_role; owner_col uuid;
begin
  r := propose_community(null, 'Founders Field');
  select m.role into role_held from memberships m
  where m.community_id = (r->>'community_id')::uuid
    and m.profile_id = '77777777-7777-4777-8777-777777777777';
  select owner_id into owner_col from communities
  where id = (r->>'community_id')::uuid;

  if r->>'status' = 'created' and role_held = 'owner'
     and owner_col = '77777777-7777-4777-8777-777777777777' then
    raise notice 'PASS 28 a top-level community needs nobody''s permission';
  else
    raise notice 'FAIL 28 status=% role=% owner=%', r->>'status', role_held, owner_col;
  end if;
exception when others then
  raise notice 'FAIL 28 %', sqlerrm;
end $$;

-- ---------- 29. my_communities and browse agree on what you can see ------
do $$
declare mine jsonb; browsable jsonb; names text;
begin
  mine := my_communities();
  browsable := browse_communities('');

  select string_agg(value->>'name', ', ') into names
  from jsonb_array_elements(browsable) value;

  -- Frank owns Founders Field and holds an unverified link membership in
  -- Summerlake, so both are "mine". Summerlake was flipped public in 20,
  -- but he is already in it, so browse must not offer it back to him.
  if jsonb_array_length(mine) = 2
     and not exists (
       select 1 from jsonb_array_elements(browsable) v
       where v->>'name' = 'Summerlake'
     ) then
    raise notice 'PASS 29 mine=2, browse excludes what you already joined (saw: %)',
      coalesce(names, 'nothing');
  else
    raise notice 'FAIL 29 mine=% browse=%', jsonb_array_length(mine), names;
  end if;
end $$;

-- ---------- 30. a private community never appears in browse ----------
do $$
declare n int;
begin
  select count(*) into n
  from jsonb_array_elements(browse_communities('Willow')) v;
  if n = 0 then
    raise notice 'PASS 30 private communities are not browsable';
  else
    raise notice 'FAIL 30 a private community was listed % time(s)', n;
  end if;
end $$;

reset role;
rollback;
