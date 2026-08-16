-- ============================================================
-- Front Porch — Phase 6: adversarial pen test.
--
-- The earlier suites test each phase's own routines. This one assumes the
-- attacker has read the source, knows every RPC exists, and does NOT use
-- them: it writes to the tables directly, the way a hand-rolled PostgREST
-- call would. Every RPC in this codebase is a convenience; the tables and
-- their grants are the actual boundary, and this file is where that claim
-- gets tested.
--
-- Three questions, over and over:
--   1. Can a signed-out visitor read anything at all?
--   2. Can a resident write a column that decides privilege?
--   3. Does authority leak sideways or upwards through the hierarchy?
--
-- Run:  docker exec -i supabase_db_Community-directory \
--         psql -U postgres -d postgres < supabase/tests/phase6_pen_test.sql
-- ============================================================

\set QUIET on
set client_min_messages to notice;
begin;

-- Cast:
--   Summerlake       5eed…0001  private, parent
--   Willow Run       5eed…0002  private, child of Summerlake
--   Wesley Whitfield 1111…0001  owner of Summerlake
--   Kate Trevino     1111…0009  admin of Summerlake
--   Dana Hollis      1111…0014  moderator of Summerlake
--   Ana Moreno       1111…0080  resident of Summerlake
--   Claire Ruiz      1111…0002  owner of Willow Run only

do $$ begin raise notice '--- Phase 6: adversarial pen test ---'; end $$;

create temp table t (k text primary key, v text);
grant all on t to authenticated;

insert into t
select 'listing', id::text from services
where community_id = '5eed0000-0000-4000-8000-000000000001' and status = 'approved'
limit 1;

insert into t
select 'household', id::text from households
where community_id = '5eed0000-0000-4000-8000-000000000001' limit 1;

insert into t
select 'announcement', id::text from announcements
where community_id = '5eed0000-0000-4000-8000-000000000001' limit 1;

-- ============================================================
-- A. THE SIGNED-OUT VISITOR
-- ============================================================

set local role anon;

-- ---------- 1. anon reads nothing, from any table ----------
do $$
declare tbl text; n int; leaked text := '';
begin
  foreach tbl in array array[
    'profiles', 'communities', 'households', 'household_members', 'memberships',
    'invites', 'invite_redemptions', 'join_requests', 'community_requests',
    'announcements', 'events', 'services', 'reports', 'notifications',
    'audit_log', 'push_subscriptions', 'service_categories'
  ] loop
    begin
      execute format('select count(*) from %I', tbl) into n;
      if n > 0 then leaked := leaked || tbl || '(' || n || ') '; end if;
    exception when others then
      -- A refusal is the pass condition; keep going.
      null;
    end;
  end loop;

  if leaked = '' then
    raise notice 'PASS 1  a signed-out visitor reads 0 rows from all 17 tables';
  else
    raise notice 'FAIL 1  anon read: %', leaked;
  end if;
end $$;

-- ---------- 2. nor can anon call the read RPCs ----------
do $$
declare n int := -1;
begin
  select jsonb_array_length(
    visible_households('5eed0000-0000-4000-8000-000000000001')->'features') into n;
  if coalesce(n, 0) = 0 then
    raise notice 'PASS 2  the map RPC yields nothing to anon';
  else
    raise notice 'FAIL 2  anon saw % pins', n;
  end if;
exception when others then
  raise notice 'PASS 2  refused (%)', sqlerrm;
end $$;

-- ============================================================
-- B. THE RESIDENT WRITING TABLES DIRECTLY
-- ============================================================

reset role;
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"11110000-0000-4000-8000-000000000080","role":"authenticated"}';

-- ---------- 3. mint yourself an invite (full table grants exist) ----------
do $$
begin
  insert into invites (community_id, code, role, created_by, max_uses)
  values ('5eed0000-0000-4000-8000-000000000001', 'PWNED123', 'admin',
          '11110000-0000-4000-8000-000000000080', 99);
  raise notice 'FAIL 3  a resident minted an admin invite by table insert';
exception when others then
  raise notice 'PASS 3  invite insert refused by policy (%)', sqlerrm;
end $$;

-- ---------- 4. read the invite codes that already exist ----------
do $$
declare n int;
begin
  select count(*) into n from invites;
  if n = 0 then
    raise notice 'PASS 4  existing invite codes are not readable by a resident';
  else
    raise notice 'FAIL 4  a resident read % invite codes', n;
  end if;
end $$;

-- ---------- 5. publish your own listing by writing status ----------
do $$
declare sid uuid; st listing_status;
begin
  insert into services (community_id, profile_id, category, title, description)
  values ('5eed0000-0000-4000-8000-000000000001',
          '11110000-0000-4000-8000-000000000080', 'tutoring', 'Self-published', 'x')
  returning id into sid;

  update services set status = 'approved', decided_by = '11110000-0000-4000-8000-000000000080'
  where id = sid;

  select status into st from services where id = sid;
  if st = 'approved' then
    raise notice 'FAIL 5  an author published their own listing';
  else
    raise notice 'PASS 5  status write ignored; listing is still %', st;
  end if;
exception when others then
  raise notice 'PASS 5  status write refused (%)', sqlerrm;
end $$;

-- ---------- 6. approve your own residency claim ----------
do $$
declare rid uuid; st request_status;
begin
  insert into join_requests (community_id, profile_id, claimed_address)
  values ('5eed0000-0000-4000-8000-000000000001',
          '11110000-0000-4000-8000-000000000080', 'anywhere')
  returning id into rid;

  update join_requests set status = 'approved' where id = rid;

  select status into st from join_requests where id = rid;
  if st = 'approved' then
    raise notice 'FAIL 6  a requester approved their own claim by table write';
  else
    raise notice 'PASS 6  self-approval write ignored; still %', st;
  end if;
exception when others then
  raise notice 'PASS 6  refused (%)', sqlerrm;
end $$;

-- ---------- 7. approve your own community request ----------
do $$
declare rid uuid; st request_status;
begin
  insert into community_requests (parent_id, requester_id, proposed_name, proposed_slug)
  values ('5eed0000-0000-4000-8000-000000000001',
          '11110000-0000-4000-8000-000000000080', 'Mine', 'mine')
  returning id into rid;

  update community_requests set status = 'approved' where id = rid;

  select status into st from community_requests where id = rid;
  if st = 'approved' then
    raise notice 'FAIL 7  a requester approved their own community';
  else
    raise notice 'PASS 7  self-approval write ignored; still %', st;
  end if;
exception when others then
  raise notice 'PASS 7  refused (%)', sqlerrm;
end $$;

-- ---------- 8. write yourself an audit row to cover tracks ----------
do $$
begin
  insert into audit_log (community_id, actor_id, action, target_type, target_id)
  values ('5eed0000-0000-4000-8000-000000000001',
          '11110000-0000-4000-8000-000000000009', 'forged.entry', 'membership',
          '11110000-0000-4000-8000-000000000080');
  raise notice 'FAIL 8  a resident forged an audit entry';
exception when others then
  raise notice 'PASS 8  the audit trail is not client-writable (%)', sqlerrm;
end $$;

-- ---------- 9. delete the audit rows about you ----------
do $$
declare before_n int; after_n int;
begin
  select count(*) into before_n from audit_log;
  delete from audit_log;
  select count(*) into after_n from audit_log;
  raise notice 'PASS 9  delete removed 0 rows (saw % before, % after)', before_n, after_n;
exception when others then
  raise notice 'PASS 9  audit delete refused (%)', sqlerrm;
end $$;

-- ---------- 10. subscribe someone else's browser to push ----------
do $$
begin
  insert into push_subscriptions (profile_id, endpoint, p256dh, auth)
  values ('11110000-0000-4000-8000-000000000009', 'https://evil/endpoint', 'k', 'a');
  raise notice 'FAIL 10 a resident attached a push endpoint to an admin';
exception when others then
  raise notice 'PASS 10 push subscriptions are RPC-only (%)', sqlerrm;
end $$;

-- ---------- 11. read whether the admin has push enabled ----------
do $$
declare n int;
begin
  select count(*) into n from push_subscriptions
  where profile_id <> '11110000-0000-4000-8000-000000000080';
  if n = 0 then
    raise notice 'PASS 11 other people''s push subscriptions are invisible';
  else
    raise notice 'FAIL 11 read % foreign subscriptions', n;
  end if;
end $$;

-- ---------- 12. plant a notification in a neighbour's inbox ----------
do $$
begin
  insert into notifications (profile_id, community_id, kind, title, body, link)
  values ('11110000-0000-4000-8000-000000000009',
          '5eed0000-0000-4000-8000-000000000001', 'announcement',
          'The board says pay me directly', 'Send $400 to...', '/');
  raise notice 'FAIL 12 a resident planted a notification in an admin''s inbox';
exception when others then
  raise notice 'PASS 12 you cannot write to someone else''s inbox (%)', sqlerrm;
end $$;

-- ---------- 13. post an announcement to the whole neighbourhood ----------
do $$
begin
  insert into announcements (community_id, kind, title, body)
  values ('5eed0000-0000-4000-8000-000000000001', 'hoa',
          'Emergency: evacuate', 'Not really.');
  raise notice 'FAIL 13 a resident broadcast to the neighbourhood';
exception when others then
  raise notice 'PASS 13 announcements are staff-only (%)', sqlerrm;
end $$;

-- ---------- 14. edit an existing announcement ----------
do $$
declare aid uuid; changed int;
begin
  select v::uuid into aid from t where k = 'announcement';
  update announcements set body = 'Send money to this account' where id = aid;
  get diagnostics changed = row_count;
  if changed = 0 then
    raise notice 'PASS 14 editing an announcement changed 0 rows';
  else
    raise notice 'FAIL 14 a resident rewrote an HOA notice';
  end if;
exception when others then
  raise notice 'PASS 14 refused (%)', sqlerrm;
end $$;

-- ---------- 15. resolve the report filed against you ----------
do $$
declare rid uuid; changed int;
begin
  insert into reports (community_id, target_type, target_id, reporter_id, reason)
  values ('5eed0000-0000-4000-8000-000000000001', 'service',
          (select v::uuid from t where k = 'listing'),
          '11110000-0000-4000-8000-000000000080', 'test')
  returning id into rid;

  update reports set status = 'dismissed', resolved_by = '11110000-0000-4000-8000-000000000080'
  where id = rid;
  get diagnostics changed = row_count;

  if changed = 0 then
    raise notice 'PASS 15 a reporter cannot resolve their own report';
  else
    raise notice 'FAIL 15 a resident resolved a report by table write';
  end if;
exception when others then
  raise notice 'PASS 15 refused (%)', sqlerrm;
end $$;

-- ---------- 16. rename the community ----------
do $$
declare changed int;
begin
  update communities set name = 'Ana''s Kingdom'
  where id = '5eed0000-0000-4000-8000-000000000001';
  get diagnostics changed = row_count;
  if changed = 0 then
    raise notice 'PASS 16 renaming the community changed 0 rows';
  else
    raise notice 'FAIL 16 a resident renamed the community';
  end if;
exception when others then
  raise notice 'PASS 16 refused (%)', sqlerrm;
end $$;

-- ---------- 17. read the admin's private notes on a household ----------
-- The local is NOT named `v`: the scratch table has a column of that name,
-- and the collision made this block raise on its own SELECT — which the
-- handler then reported as a refusal the database never actually issued.
do $$
declare secret_notes text; target uuid;
begin
  select t.v::uuid into target from t where t.k = 'household';
  execute 'select notes from households where id = $1' using target into secret_notes;
  raise notice 'FAIL 17 a resident read household.notes: %', coalesce(secret_notes, '(null)');
exception when others then
  raise notice 'PASS 17 household.notes is not column-readable (%)', sqlerrm;
end $$;

-- ---------- 18. read a neighbour's raw phone from profiles ----------
do $$
declare n int;
begin
  select count(*) into n from profiles
  where id <> '11110000-0000-4000-8000-000000000080';
  if n = 0 then
    raise notice 'PASS 18 profiles is self-only; 0 neighbours readable';
  else
    raise notice 'FAIL 18 a resident read % profiles', n;
  end if;
end $$;

-- ============================================================
-- C. AUTHORITY MOVING SIDEWAYS AND UPWARDS
-- ============================================================

reset role;
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"11110000-0000-4000-8000-000000000002","role":"authenticated"}';

-- ---------- 19. a child community's owner reaches into the parent ----------
do $$
begin
  if has_role_at_or_above('5eed0000-0000-4000-8000-000000000001', 'moderator') then
    raise notice 'FAIL 19 Willow Run''s owner holds authority over Summerlake';
  else
    raise notice 'PASS 19 authority does not climb from child to parent';
  end if;
end $$;

-- ---------- 20. nor read the parent's member list ----------
do $$
declare n int;
begin
  select jsonb_array_length(
    community_members('5eed0000-0000-4000-8000-000000000001')) into n;
  if n = 0 then
    raise notice 'PASS 20 the parent''s member list is closed to a child owner';
  else
    raise notice 'FAIL 20 read % members of the parent', n;
  end if;
exception when others then
  raise notice 'PASS 20 refused (%)', sqlerrm;
end $$;

-- ---------- 21. nor its audit trail ----------
do $$
declare n int;
begin
  select jsonb_array_length(
    audit_feed('5eed0000-0000-4000-8000-000000000001')) into n;
  if n = 0 then
    raise notice 'PASS 21 the parent''s audit trail is closed';
  else
    raise notice 'FAIL 21 read % audit rows of the parent', n;
  end if;
exception when others then
  raise notice 'PASS 21 refused (%)', sqlerrm;
end $$;

-- ---------- 22. nor moderate its listings ----------
do $$
declare sid uuid;
begin
  select v::uuid into sid from t where k = 'listing';
  perform decide_service(sid, false, 'not my community');
  raise notice 'FAIL 22 a child owner moderated the parent''s listings';
exception when others then
  raise notice 'PASS 22 refused (%)', sqlerrm;
end $$;

-- ---------- 23. but a PARENT admin does reach down ----------
reset role;
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"11110000-0000-4000-8000-000000000009","role":"authenticated"}';

do $$
begin
  if has_role_at_or_above('5eed0000-0000-4000-8000-000000000002', 'admin') then
    raise notice 'PASS 23 a parent admin does hold authority over the child';
  else
    raise notice 'FAIL 23 oversight does not reach the sub-community';
  end if;
end $$;

-- ---------- 24. yet the parent's residents do NOT see the child's people --
-- The deliberate asymmetry from migration 3: oversight inherits downward,
-- the directory does not. An umbrella HOA member must not automatically
-- read every constituent street's contact list.
reset role;
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"11110000-0000-4000-8000-000000000080","role":"authenticated"}';

do $$
declare n int;
begin
  select jsonb_array_length(
    visible_households('5eed0000-0000-4000-8000-000000000002')->'features') into n;
  if coalesce(n, 0) = 0 then
    raise notice 'PASS 24 a parent resident sees 0 pins in the sub-community';
  else
    raise notice 'FAIL 24 a parent resident read % child pins', n;
  end if;
exception when others then
  raise notice 'PASS 24 refused (%)', sqlerrm;
end $$;

-- ---------- 25. a moderator cannot change the community's visibility ------
reset role;
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"11110000-0000-4000-8000-000000000014","role":"authenticated"}';

do $$
declare changed int; vis community_visibility;
begin
  update communities set visibility = 'public'
  where id = '5eed0000-0000-4000-8000-000000000001';
  get diagnostics changed = row_count;

  select visibility into vis from communities
  where id = '5eed0000-0000-4000-8000-000000000001';

  if changed = 0 and vis = 'private' then
    raise notice 'PASS 25 visibility write matched 0 rows; still private';
  else
    raise notice 'FAIL 25 a moderator made a private community % (% rows)', vis, changed;
  end if;
exception when others then
  raise notice 'PASS 25 visibility is admin-only (%)', sqlerrm;
end $$;

-- ---------- 26. nor promote themselves through the column grant ----------
do $$
declare r member_role;
begin
  update memberships set role = 'admin'
  where profile_id = '11110000-0000-4000-8000-000000000014';
  select role into r from memberships
  where profile_id = '11110000-0000-4000-8000-000000000014'
    and community_id = '5eed0000-0000-4000-8000-000000000001';
  if r = 'admin' then
    raise notice 'FAIL 26 a moderator promoted themselves';
  else
    raise notice 'PASS 26 role write ignored; still %', r;
  end if;
exception when others then
  raise notice 'PASS 26 role is not in the column grant (%)', sqlerrm;
end $$;

-- ---------- 27. nor drain the push queue ----------
do $$
declare n int;
begin
  select jsonb_array_length(pending_push_batch(10)) into n;
  raise notice 'FAIL 27 a moderator drained % push jobs', n;
exception when others then
  raise notice 'PASS 27 the push queue is service_role only (%)', sqlerrm;
end $$;

-- ============================================================
-- D. THE VERIFIED NEIGHBOUR WHO KNOWS TOO MUCH
-- ============================================================

reset role;
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"11110000-0000-4000-8000-000000000080","role":"authenticated"}';

-- ---------- 28. read a household card in a community you are not in ------
do $$
declare card jsonb; hh uuid;
begin
  select id into hh from households
  where community_id = '5eed0000-0000-4000-8000-000000000002' limit 1;
  card := household_card(hh);
  if card is null or card = 'null'::jsonb or card->'residents' is null then
    raise notice 'PASS 28 a card outside your community yields nothing';
  else
    raise notice 'FAIL 28 read a card from a community they do not belong to';
  end if;
exception when others then
  raise notice 'PASS 28 refused (%)', sqlerrm;
end $$;

-- ---------- 29. enumerate addresses in a community you are not in --------
do $$
declare n int;
begin
  select count(*) into n
  from claimable_addresses('5eed0000-0000-4000-8000-000000000002', '');
  if n = 0 then
    raise notice 'PASS 29 addresses of a foreign private community are closed';
  else
    raise notice 'FAIL 29 enumerated % foreign addresses', n;
  end if;
exception when others then
  raise notice 'PASS 29 refused (%)', sqlerrm;
end $$;

-- ---------- 30. attach yourself to a neighbour's household ---------------
do $$
declare hh uuid; changed int;
begin
  select v::uuid into hh from t where k = 'household';
  insert into household_members (household_id, profile_id, relationship)
  values (hh, '11110000-0000-4000-8000-000000000080', 'owner');
  raise notice 'FAIL 30 a resident added themselves to a neighbour''s home';
exception when others then
  raise notice 'PASS 30 household membership is RPC-only (%)', sqlerrm;
end $$;

-- ---------- 31. move a neighbour's pin off the map -----------------------
do $$
declare hh uuid; changed int;
begin
  select v::uuid into hh from t where k = 'household';
  update households set geo = st_point(0, 0)::geography where id = hh;
  get diagnostics changed = row_count;
  if changed = 0 then
    raise notice 'PASS 31 moving a neighbour''s pin changed 0 rows';
  else
    raise notice 'FAIL 31 a resident moved a neighbour''s home';
  end if;
exception when others then
  raise notice 'PASS 31 refused (%)', sqlerrm;
end $$;

-- ---------- 32. redeem an invite you were not given ----------------------
-- The code is the credential, so this is really a test that redemption is
-- not reachable by writing invite_redemptions directly.
do $$
begin
  insert into invite_redemptions (invite_id, profile_id)
  select id, '11110000-0000-4000-8000-000000000080' from invites limit 1;
  raise notice 'FAIL 32 a resident forged an invite redemption';
exception when others then
  raise notice 'PASS 32 redemption is RPC-only (%)', sqlerrm;
end $$;

reset role;
rollback;
