-- ============================================================
-- Front Porch — Phase 5: announcements, moderation, reports, audit, inbox.
--
-- Same discipline as the earlier suites: every routine is called by someone
-- one rung too low and the pass condition is a refusal, arriving either as
-- an exception or as an empty result.
--
-- Run:  docker exec -i supabase_db_Community-directory \
--         psql -U postgres -d postgres < supabase/tests/phase5_moderation.sql
-- ============================================================

\set QUIET on
set client_min_messages to notice;
begin;

-- Seeded cast:
--   Summerlake      5eed…0001
--   Wesley Whitfield 1111…0001  owner
--   Kate Trevino     1111…0009  admin
--   Dana Hollis      1111…0014  moderator
--   Ana Moreno       1111…0080  plain verified resident
--   Ana Petrov       1111…0016  a second plain resident

do $$ begin raise notice '--- Phase 5: moderation and the inbox ---'; end $$;

create temp table t (k text primary key, v text);
grant all on t to authenticated;

-- ============================================================
-- ANNOUNCEMENTS
-- ============================================================

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"11110000-0000-4000-8000-000000000014","role":"authenticated"}';

-- ---------- 1. a moderator cannot speak for the association ----------
do $$
begin
  insert into announcements (community_id, kind, title, body)
  values ('5eed0000-0000-4000-8000-000000000001', 'hoa',
          'Dues are going up', 'Signed, the board.');
  raise notice 'FAIL 1  a moderator posted as the HOA';
exception when others then
  raise notice 'PASS 1  the official voice is admin-only (%)', sqlerrm;
end $$;

-- ---------- 2. but they may post as a neighbour ----------
do $$
declare n int;
begin
  insert into announcements (community_id, kind, title, body)
  values ('5eed0000-0000-4000-8000-000000000001', 'neighbor',
          'Skip in the cul-de-sac on Saturday', 'Room for a few more bags.');
  select count(*) into n from announcements
  where title = 'Skip in the cul-de-sac on Saturday';
  if n = 1 then
    raise notice 'PASS 2  moderator posted a neighbour notice';
  else
    raise notice 'FAIL 2  % rows', n;
  end if;
exception when others then
  raise notice 'FAIL 2  %', sqlerrm;
end $$;

-- ---------- 3. and it reached every verified neighbour but them ----------
-- Counted as `postgres`, not as Dana: notifications carries a self-only
-- policy, so asking this question in-role would answer 0 no matter what the
-- trigger did, and the test would pass for the wrong reason once it broke.
reset role;

do $$
declare reached int; self_notified int; verified_members int;
begin
  select count(*) into reached from notifications
  where title = 'Skip in the cul-de-sac on Saturday';
  select count(*) into self_notified from notifications
  where title = 'Skip in the cul-de-sac on Saturday'
    and profile_id = '11110000-0000-4000-8000-000000000014';
  select count(*) into verified_members from memberships
  where community_id = '5eed0000-0000-4000-8000-000000000001'
    and verification_status = 'verified';

  if reached = verified_members - 1 and self_notified = 0 then
    raise notice 'PASS 3  % neighbours notified, the author was not', reached;
  else
    raise notice 'FAIL 3  reached=% self=% members=%',
      reached, self_notified, verified_members;
  end if;
end $$;

-- ---------- 4. a plain resident cannot post at all ----------
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"11110000-0000-4000-8000-000000000080","role":"authenticated"}';

do $$
begin
  insert into announcements (community_id, kind, title, body)
  values ('5eed0000-0000-4000-8000-000000000001', 'neighbor', 'Hello', 'Hi.');
  raise notice 'FAIL 4  a resident posted an announcement';
exception when others then
  raise notice 'PASS 4  residents cannot post (%)', sqlerrm;
end $$;

-- ============================================================
-- SERVICE MODERATION
-- ============================================================

-- ---------- 5. a resident files a listing, and it is not public ----------
do $$
declare sid uuid; st listing_status;
begin
  insert into services (community_id, profile_id, category, title, description)
  values ('5eed0000-0000-4000-8000-000000000001',
          '11110000-0000-4000-8000-000000000080', 'tutoring',
          'Maths tutoring, GCSE and A-level', 'Weekday evenings.')
  returning id, status into sid, st;
  insert into t values ('listing', sid::text);

  if st = 'pending' then
    raise notice 'PASS 5  a new listing starts pending';
  else
    raise notice 'FAIL 5  status=%', st;
  end if;
exception when others then
  raise notice 'FAIL 5  %', sqlerrm;
end $$;

-- ---------- 6. the author cannot see the moderation queue ----------
do $$
declare n int;
begin
  select jsonb_array_length(
    moderation_queue('5eed0000-0000-4000-8000-000000000001')) into n;
  if n = 0 then
    raise notice 'PASS 6  the queue is empty to a resident';
  else
    raise notice 'FAIL 6  a resident read % queued listings', n;
  end if;
exception when others then
  raise notice 'PASS 6  refused (%)', sqlerrm;
end $$;

-- ---------- 7. nor approve it ----------
do $$
declare sid uuid;
begin
  select v::uuid into sid from t where k = 'listing';
  perform decide_service(sid, true);
  raise notice 'FAIL 7  an author approved their own listing';
exception when others then
  raise notice 'PASS 7  self-approval refused (%)', sqlerrm;
end $$;

-- ---------- 8. a moderator sees it, with the author named ----------
reset role;
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"11110000-0000-4000-8000-000000000014","role":"authenticated"}';

do $$
declare q jsonb; row jsonb; sid uuid;
begin
  select v::uuid into sid from t where k = 'listing';
  q := moderation_queue('5eed0000-0000-4000-8000-000000000001');
  select value into row from jsonb_array_elements(q) value
  where value->>'id' = sid::text;

  if row is null then
    raise notice 'FAIL 8  the listing is missing from the queue';
  elsif row->>'author' = 'Ana Moreno' and row->>'category_label' = 'Tutoring' then
    raise notice 'PASS 8  queue names the author and the category';
  else
    raise notice 'FAIL 8  %', row;
  end if;
end $$;

-- ---------- 9. a rejection must carry a reason ----------
do $$
declare sid uuid;
begin
  select v::uuid into sid from t where k = 'listing';
  perform decide_service(sid, false, '   ');
  raise notice 'FAIL 9  rejected a listing with no reason';
exception when others then
  raise notice 'PASS 9  a rejection owes the author an explanation (%)', sqlerrm;
end $$;

-- ---------- 10. approval publishes it, and tells the author ----------
-- Baselines first: these counts must be a DELTA, not a total. Counting every
-- 'Your listing is live' notification in the database made the suite depend
-- on whatever the E2E run had approved earlier that afternoon.
reset role;
insert into t
select 'told_before', count(*)::text from notifications
where profile_id = '11110000-0000-4000-8000-000000000080'
  and title = 'Your listing is live';
insert into t
select 'logged_before', count(*)::text from audit_log where action = 'service.approve';

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"11110000-0000-4000-8000-000000000014","role":"authenticated"}';

do $$
declare sid uuid;
begin
  select v::uuid into sid from t where k = 'listing';
  perform decide_service(sid, true);
exception when others then
  raise notice 'FAIL 10 %', sqlerrm;
end $$;

-- The author's notification and the audit row are both invisible to Dana by
-- design, so the check drops role to look at what actually landed.
reset role;

do $$
declare sid uuid; st listing_status; told int; logged int;
begin
  select v::uuid into sid from t where k = 'listing';
  select status into st from services where id = sid;

  select count(*) - (select v::int from t where k = 'told_before') into told
  from notifications
  where profile_id = '11110000-0000-4000-8000-000000000080'
    and title = 'Your listing is live';

  select count(*) - (select v::int from t where k = 'logged_before') into logged
  from audit_log where action = 'service.approve';

  if st = 'approved' and told = 1 and logged = 1 then
    raise notice 'PASS 10 approved, author notified, audit written';
  else
    raise notice 'FAIL 10 status=% told=% logged=%', st, told, logged;
  end if;
end $$;

-- ============================================================
-- REPORTS
-- ============================================================

-- ---------- 11. a neighbour reports it ----------
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"11110000-0000-4000-8000-000000000016","role":"authenticated"}';

do $$
declare sid uuid; rid uuid; again uuid;
begin
  select v::uuid into sid from t where k = 'listing';
  rid := report_content('service', sid, 'Spam', 'Same advert three times.');
  insert into t values ('report', rid::text);

  -- Filing twice must not queue twice. Without this a grudge is a for-loop.
  again := report_content('service', sid, 'Spam', 'Again.');

  if rid is not null and again = rid then
    raise notice 'PASS 11 reported once; a repeat returns the same open report';
  else
    raise notice 'FAIL 11 rid=% again=%', rid, again;
  end if;
exception when others then
  raise notice 'FAIL 11 %', sqlerrm;
end $$;

-- ---------- 12. a reporter cannot read the moderators' queue ----------
do $$
declare n int;
begin
  select jsonb_array_length(
    reports_queue('5eed0000-0000-4000-8000-000000000001')) into n;
  if n = 0 then
    raise notice 'PASS 12 the reports queue is empty to a resident';
  else
    raise notice 'FAIL 12 a resident read % reports', n;
  end if;
exception when others then
  raise notice 'PASS 12 refused (%)', sqlerrm;
end $$;

-- ---------- 13. nor resolve their own report ----------
do $$
declare rid uuid;
begin
  select v::uuid into rid from t where k = 'report';
  perform resolve_report(rid, 'dismiss', 'Never mind.');
  raise notice 'FAIL 13 a resident resolved a report';
exception when others then
  raise notice 'PASS 13 resolution is a moderator''s job (%)', sqlerrm;
end $$;

-- ---------- 14. a second neighbour reports the same listing ----------
reset role;
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"11110000-0000-4000-8000-000000000112","role":"authenticated"}';

do $$
declare sid uuid;
begin
  select v::uuid into sid from t where k = 'listing';
  perform report_content('service', sid, 'Spam', 'Agreed, this is spam.');
  raise notice 'PASS 14 a second neighbour reported it independently';
exception when others then
  raise notice 'FAIL 14 %', sqlerrm;
end $$;

-- ---------- 15. the moderator sees one entry that counts both ----------
reset role;
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"11110000-0000-4000-8000-000000000014","role":"authenticated"}';

do $$
declare q jsonb; row jsonb; sid uuid;
begin
  select v::uuid into sid from t where k = 'listing';
  q := reports_queue('5eed0000-0000-4000-8000-000000000001');
  select value into row from jsonb_array_elements(q) value
  where value->>'target_id' = sid::text
  limit 1;

  if row is null then
    raise notice 'FAIL 15 the report is missing from the queue';
  elsif (row->>'also_reported_by')::int = 1
        and row->>'summary' = 'Maths tutoring, GCSE and A-level' then
    raise notice 'PASS 15 queue shows the content and that a second person agreed';
  else
    raise notice 'FAIL 15 %', row;
  end if;
end $$;

-- ---------- 16. a report about a person is not resolved from here ----------
do $$
declare rid uuid;
begin
  insert into reports (community_id, target_type, target_id, reporter_id, reason)
  values ('5eed0000-0000-4000-8000-000000000001', 'profile',
          '11110000-0000-4000-8000-000000000080',
          '11110000-0000-4000-8000-000000000014', 'Rude in the group chat')
  returning id into rid;

  perform resolve_report(rid, 'remove', 'Removing them.');
  raise notice 'FAIL 16 a moderator removed a person from the reports queue';
exception when others then
  raise notice 'PASS 16 people are handled on the members screen (%)', sqlerrm;
end $$;

-- ---------- 17. removing the listing closes every open report on it ----
reset role;
insert into t
select 'thanks_before', count(*)::text from notifications
where kind = 'report' and title = 'Thanks — we took that down';

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"11110000-0000-4000-8000-000000000014","role":"authenticated"}';

do $$
begin
  perform resolve_report((select v::uuid from t where k = 'report'),
                         'remove', 'Duplicate advert.');
exception when others then
  raise notice 'FAIL 17 %', sqlerrm;
end $$;

reset role;

do $$
declare sid uuid; st listing_status; still_open int; told int;
begin
  select v::uuid into sid from t where k = 'listing';
  select status into st from services where id = sid;
  select count(*) into still_open from reports
  where target_id = sid and status = 'open';
  select count(*) - (select v::int from t where k = 'thanks_before') into told
  from notifications
  where kind = 'report' and title = 'Thanks — we took that down';

  if st = 'rejected' and still_open = 0 and told = 2 then
    raise notice 'PASS 17 listing pulled, both reports closed, both reporters told';
  else
    raise notice 'FAIL 17 status=% open=% told=%', st, still_open, told;
  end if;
end $$;

-- ============================================================
-- AUDIT AND INBOX
-- ============================================================

-- ---------- 18. the audit trail is admin-only ----------
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"11110000-0000-4000-8000-000000000014","role":"authenticated"}';

do $$
declare n int;
begin
  select jsonb_array_length(
    audit_feed('5eed0000-0000-4000-8000-000000000001')) into n;
  if n = 0 then
    raise notice 'PASS 18 a moderator cannot read the audit trail';
  else
    raise notice 'FAIL 18 a moderator read % audit rows', n;
  end if;
exception when others then
  raise notice 'PASS 18 refused (%)', sqlerrm;
end $$;

-- ---------- 19. an admin can, with actors named ----------
reset role;
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"11110000-0000-4000-8000-000000000009","role":"authenticated"}';

do $$
declare f jsonb; row jsonb;
begin
  f := audit_feed('5eed0000-0000-4000-8000-000000000001');
  select value into row from jsonb_array_elements(f) value
  where value->>'action' = 'service.approve';

  if jsonb_array_length(f) > 0 and row->>'actor' = 'Dana Hollis' then
    raise notice 'PASS 19 admin reads % audit rows, actor named', jsonb_array_length(f);
  else
    raise notice 'FAIL 19 rows=% row=%', jsonb_array_length(f), row;
  end if;
end $$;

-- ---------- 20. the inbox is yours alone ----------
reset role;
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"11110000-0000-4000-8000-000000000080","role":"authenticated"}';

do $$
declare mine jsonb; leaked int;
begin
  mine := notification_feed(200);
  select count(*) into leaked
  from jsonb_array_elements(mine) v
  join notifications n on n.id = (v->>'id')::uuid
  where n.profile_id <> '11110000-0000-4000-8000-000000000080';

  if jsonb_array_length(mine) > 0 and leaked = 0 then
    raise notice 'PASS 20 % notifications, none belonging to anyone else',
      jsonb_array_length(mine);
  else
    raise notice 'FAIL 20 rows=% leaked=%', jsonb_array_length(mine), leaked;
  end if;
end $$;

-- ---------- 21. marking read touches nothing of anyone else's ----------
do $$
declare before_others int; after_others int; mine_unread int; touched int;
begin
  select count(*) into before_others from notifications
  where profile_id <> '11110000-0000-4000-8000-000000000080' and read_at is null;

  touched := mark_notifications_read(null);

  select count(*) into after_others from notifications
  where profile_id <> '11110000-0000-4000-8000-000000000080' and read_at is null;
  select unread_notification_count() into mine_unread;

  if mine_unread = 0 and after_others = before_others and touched > 0 then
    raise notice 'PASS 21 marked % of my own read, % of everyone else''s untouched',
      touched, before_others;
  else
    raise notice 'FAIL 21 mine=% before=% after=% touched=%',
      mine_unread, before_others, after_others, touched;
  end if;
end $$;

-- ---------- 22. an outsider cannot report into a community ----------
-- Created as postgres: auth.users is not writable by `authenticated`, and
-- leaving the role set here aborted the whole transaction mid-suite.
reset role;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        confirmation_token, recovery_token, email_change_token_new,
                        email_change, email_change_token_current, phone_change,
                        phone_change_token, reauthentication_token)
values ('44444444-4444-4444-8444-444444444444',
        '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'outsider@elsewhere.test', 'x', now(), now(), now(),
        '', '', '', '', '', '', '', '');
insert into profiles (id, full_name, email)
values ('44444444-4444-4444-8444-444444444444', 'Otto Outsider', 'outsider@elsewhere.test');

reset role;
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';

do $$
declare sid uuid;
begin
  select v::uuid into sid from t where k = 'listing';
  perform report_content('service', sid, 'I do not like it');
  raise notice 'FAIL 22 an outsider filed a report into a community';
exception when others then
  raise notice 'PASS 22 you can only report where you live (%)', sqlerrm;
end $$;

reset role;
rollback;
