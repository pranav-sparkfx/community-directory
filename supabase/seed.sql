-- ============================================================
-- Front Porch — Summerlake seed
--
-- A fictional 128-home community matching the Figma mockups exactly:
-- the street names, the announcement copy, and the six service
-- categories with their neighbour counts. Demos read as real, and map
-- clustering plus the bbox query get an honest load to run against.
--
-- TWO CONSTRAINTS THIS FILE MUST RESPECT — both learned the hard way:
--
--   1. NO STAGING TABLES. The Supabase CLI executes seed files through a
--      pgx batch, which PARSES every statement before EXECUTING any of
--      them. A `create table x` followed by `insert into x` fails at
--      parse time with a confusing "relation x does not exist", even
--      though the same file runs fine under psql. Every statement here
--      is therefore self-contained, using data-modifying CTEs.
--
--   2. NO DOLLAR-QUOTED BLOCKS. The same splitter does not understand
--      $$ ... $$, so a DO block gets cut mid-body.
--
-- Identity is deterministic rather than random: person N always gets
-- uuid 11110000-...-N and always lands at the same address, so
-- `supabase db reset` reproduces the same neighbourhood every time and
-- visual-regression diffs stay meaningful.
--
-- Runs as `postgres`, which bypasses RLS. Nothing here tests the
-- policies — see supabase/tests/rls_adversarial.sql for that.
-- ============================================================

select setseed(0.42);

-- ---------- people --------------------------------------------
-- auth.users and profiles are populated in a single statement so the
-- generated uuids agree without a staging table to hold them.

with people as (
  select
    i,
    ('11110000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid as id,
    (array['Murali','Jaya','Dana','Marcus','Priya','Tom','Elena','Wesley','Nina','Andre',
           'Sofia','Hank','Ruth','Omar','Claire','Desmond','Ana','Peter','Lila','Grant',
           'Yusuf','Bea','Caleb','Rosa','Ivan','Maya','Frank','Delia','Theo','Simone',
           'Arjun','Kate'])[1 + ((i * 7) % 32)] as first_name,
    (array['Varadarajan','Swamy','Okafor','Brennan','Nair','Whitfield','Castellanos','Boone',
           'Petrov','Mensah','Ruiz','Delaney','Abernathy','Haddad','Fontaine','Ellery',
           'Moreno','Lindqvist','Ashworth','Calloway','Demir','Trevino','Hollis','Barrera'])[1 + ((i * 5) % 24)] as last_name
  from generate_series(1, 168) i
),
named as (
  select *,
    lower(first_name) || '.' || lower(last_name) || i || '@summerlake.test' as email,
    '+1704' || lpad((5550000 + i)::text, 7, '0') as phone
  from people
),
new_users as (
  -- The token columns are set to '' rather than left NULL on purpose.
  -- GoTrue scans them into Go strings, and a NULL fails with
  --   "converting NULL to string is unsupported"
  -- which surfaces to the user as the thoroughly unhelpful
  --   "Database error querying schema"
  -- on every sign-in attempt. Omitting them makes seeded accounts unusable.
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at,
                          raw_app_meta_data, raw_user_meta_data,
                          confirmation_token, recovery_token,
                          email_change_token_new, email_change,
                          email_change_token_current, phone_change,
                          phone_change_token, reauthentication_token)
  select id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         email, crypt('summerlake', gen_salt('bf')), now(), now(), now(),
         '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
         '', '', '', '', '', '', '', ''
  from named
  returning id
)
insert into profiles (id, full_name, email, phone)
select id, first_name || ' ' || last_name, email, phone from named;

-- ---------- community -----------------------------------------
-- `path` is supplied deliberately wrong; the derive trigger overwrites
-- it from the slug, which is the C3 protection working during seeding too.

insert into communities (id, parent_id, path, name, slug, description,
                         visibility, center, default_zoom, owner_id)
values (
  '5eed0000-0000-4000-8000-000000000001', null, 'ignored',
  'Summerlake', 'summerlake',
  'A 128-home neighbourhood around Summerlake pond.',
  'private',
  st_point(-80.8431, 35.2271)::geography, 15.4,
  '11110000-0000-4000-8000-000000000001'
);

-- A sub-community, so nested roles and downward inheritance have
-- something real to exercise from Phase 4 onward.
insert into communities (id, parent_id, path, name, slug, description,
                         visibility, center, default_zoom, owner_id)
values (
  '5eed0000-0000-4000-8000-000000000002',
  '5eed0000-0000-4000-8000-000000000001', 'ignored',
  'Willow Run', 'willow_run',
  'The twelve homes along Willow Run.',
  'private',
  st_point(-80.8459, 35.2296)::geography, 16.2,
  '11110000-0000-4000-8000-000000000002'
);

-- ---------- households ----------------------------------------
-- The four streets from the mockups, laid out with a small deterministic
-- jitter so the map does not read like a spreadsheet.

insert into households (community_id, address_line1, city, state, postal_code, geo, status)
select
  case when s.street = 'Willow Run'
       then '5eed0000-0000-4000-8000-000000000002'::uuid
       else '5eed0000-0000-4000-8000-000000000001'::uuid end,
  (s.base_num + (n - 1) * 2)::text || ' ' || s.street,
  'Charlotte', 'NC', '28269',
  st_point(
    s.lng0 + s.dlng * n + (random() - 0.5) * 0.00018,
    s.lat0 + s.dlat * n + (random() - 0.5) * 0.00018
  )::geography,
  -- Two homes stand vacant so "active vs inactive homes" on the admin
  -- dashboard is not a column of zeros.
  case when s.street = 'Cedar Bend' and n in (7, 23)
       then 'inactive'::household_status else 'active'::household_status end
from (values
  ('Flintgrove Loop', 40, 2600, 35.2258, -80.8447,  0.00024,  0.00031),
  ('Heron Ridge',     32, 1400, 35.2299, -80.8471,  0.00019, -0.00012),
  ('Cedar Bend',      44,  300, 35.2281, -80.8402, -0.00016,  0.00028),
  ('Willow Run',      12,  700, 35.2296, -80.8459,  0.00021,  0.00022)
) as s(street, homes, base_num, lat0, lng0, dlat, dlng),
lateral generate_series(1, s.homes) n;

-- ---------- residents -----------------------------------------
-- Primary owner per active household. `hn` is recomputed from address
-- ordering in every statement below, which is what keeps the assignment
-- stable without a staging table to hold it.

insert into household_members (household_id, profile_id, relationship, is_primary,
                               is_listed, resident_since)
select
  a.household_id,
  ('11110000-0000-4000-8000-' || lpad(a.hn::text, 12, '0'))::uuid,
  'owner', true, true,
  make_date((2015 + (a.hn % 10))::int, (1 + (a.hn % 12))::int, (1 + (a.hn % 27))::int)
from (
  select h.id as household_id, row_number() over (order by h.address_line1) as hn
  from households h where h.status = 'active'
) a;

-- Every third household lists a partner — the AvatarPair case in Figma.
insert into household_members (household_id, profile_id, relationship, is_primary,
                               is_listed, resident_since)
select
  a.household_id,
  ('11110000-0000-4000-8000-' || lpad((a.hn + 126)::text, 12, '0'))::uuid,
  'member', false, true,
  make_date((2015 + (a.hn % 10))::int, (1 + (a.hn % 12))::int, (1 + (a.hn % 27))::int)
from (
  select h.id as household_id, row_number() over (order by h.address_line1) as hn
  from households h where h.status = 'active'
) a
where a.hn % 3 = 0 and a.hn + 126 <= 168;

insert into memberships (community_id, profile_id, household_id, role,
                         verification_status, verified_at, phone_vis, email_vis,
                         show_on_map, show_in_directory, joined_at)
select
  a.community_id, hm.profile_id, a.household_id,
  case
    when a.hn = 1 then 'owner'::member_role
    when a.hn in (4, 9) then 'admin'::member_role
    when a.hn in (14, 27) then 'moderator'::member_role
    else 'resident'::member_role
  end,
  -- Four residents sit unverified so the admin queue has real work and
  -- "unverified is invisible" is observable in the running app.
  case when a.hn in (11, 34, 58, 97) then 'pending'::verification_status
       else 'verified'::verification_status end,
  case when a.hn in (11, 34, 58, 97) then null
       else now() - (a.hn || ' days')::interval end,
  case when a.hn % 7 = 0 then 'hidden'::phone_visibility
       when a.hn % 3 = 0 then 'call_and_text'::phone_visibility
       else 'text_only'::phone_visibility end,
  case when a.hn % 5 = 0 then 'visible'::email_visibility
       else 'hidden'::email_visibility end,
  -- Three residents opted off the map. Their pins must be absent, not grey.
  a.hn not in (19, 52, 88),
  a.hn not in (19, 52),
  now() - (a.hn || ' days')::interval
from (
  select h.id as household_id, h.community_id,
         row_number() over (order by h.address_line1) as hn
  from households h where h.status = 'active'
) a
join household_members hm on hm.household_id = a.household_id
on conflict (community_id, profile_id) do nothing;

-- The roles above are derived from house numbering, which knows nothing
-- about communities.owner_id. Phase 4 makes those two facts one: ownership
-- moves only when the communities row and the owner's membership agree, so
-- a community whose owner_id named someone with no membership in it would
-- be untransferable forever. Willow Run was exactly that.
alter table memberships disable trigger memberships_guard;

insert into memberships (community_id, profile_id, role, verification_status, verified_at)
select c.id, c.owner_id, 'owner', 'verified', now()
from communities c
where c.owner_id is not null
on conflict (community_id, profile_id) do update
set role = 'owner',
    verification_status = 'verified',
    verified_at = coalesce(memberships.verified_at, now());

alter table memberships enable trigger memberships_guard;

-- ---------- service categories --------------------------------
-- Labels and order match the Services screen in Figma.

insert into service_categories (slug, label, icon, accent, sort_order) values
  ('pet_care',       'Pet Care',        'paw',     'clay',   1),
  ('babysitting',    'Babysitting',     'child',   'forest', 2),
  ('tutoring',       'Tutoring',        'book',    'clay',   3),
  ('home_repair',    'Home Repair',     'hammer',  'forest', 4),
  ('rides_errands',  'Rides & Errands', 'car',     'clay',   5),
  ('tech_help',      'Tech Help',       'monitor', 'forest', 6);

-- Exactly the neighbour counts on the mockup: 6 / 4 / 3 / 5 / 2 / 3.

insert into services (community_id, profile_id, household_id, category, title,
                      description, availability, status, decided_at)
select
  a.community_id, hm.profile_id, a.household_id, c.slug, c.title,
  c.description, c.availability, 'approved', now()
from (values
  ('pet_care',      'Dog walking & drop-in visits', 'Happy to take your dog out midday or feed cats while you travel.', 'weekdays',     1, 6),
  ('babysitting',   'Evening babysitting',          'CPR certified, references from three families on the loop.',       'evenings',     7, 4),
  ('tutoring',      'Maths & piano tutoring',       'Secondary maths and beginner piano. First session free.',          'math, piano', 11, 3),
  ('home_repair',   'Handyman & small repairs',     'Gutters, fences, drywall patching. No plumbing.',                  'weekends',    14, 5),
  ('rides_errands', 'Rides & errands',              'Airport runs and grocery pickups for neighbours who need a lift.', 'weekdays',    19, 2),
  ('tech_help',     'Tech help',                    'Wi-Fi, printers, phones. Patient with all questions.',             'evenings',    21, 3)
) as c(slug, title, description, availability, start_hn, qty)
join (
  select h.id as household_id, h.community_id,
         row_number() over (order by h.address_line1) as hn
  from households h where h.status = 'active'
) a on a.hn between c.start_hn and c.start_hn + c.qty - 1
join household_members hm on hm.household_id = a.household_id and hm.is_primary;

-- One listing awaiting moderation, so the approval queue is not empty and
-- "pending is invisible to neighbours" is observable in the running app.
insert into services (community_id, profile_id, household_id, category, title,
                      description, availability, status)
select a.community_id, hm.profile_id, a.household_id, 'home_repair',
       'Pressure washing', 'Driveways and siding. Bring your own water.', 'weekends', 'pending'
from (
  select h.id as household_id, h.community_id,
         row_number() over (order by h.address_line1) as hn
  from households h where h.status = 'active'
) a
join household_members hm on hm.household_id = a.household_id and hm.is_primary
where a.hn = 45;

-- ---------- announcements -------------------------------------
-- Copy lifted verbatim from the Announcements screen in Figma.

-- The guard on `kind` asks has_role_at_or_above(), which reads auth.uid();
-- a seed has no authenticated caller to be, so it is stood down for these
-- rows. The fan-out trigger is deliberately left ON: it fills every seeded
-- resident's inbox, which is the only way the notification screen has
-- anything real to show on a fresh database.
alter table announcements disable trigger announcements_guard_trg;

insert into announcements (community_id, author_id, kind, title, body, pinned, publish_at)
values
  ('5eed0000-0000-4000-8000-000000000001','11110000-0000-4000-8000-000000000004','hoa',
   'Spring hydrant flushing, Mar 18–20',
   'Water may run cloudy for a few hours. Run cold taps until clear before doing laundry.',
   false, now() - interval '3 days'),
  ('5eed0000-0000-4000-8000-000000000001','11110000-0000-4000-8000-000000000004','hoa',
   'Pool opens Memorial Day weekend',
   'Badges are being mailed now — four per household. Request extras through the board by May 1.',
   false, now() - interval '8 days'),
  ('5eed0000-0000-4000-8000-000000000001','11110000-0000-4000-8000-000000000027','neighbor',
   'Lost tabby near Willow Run',
   'Grey with a white chest, answers to Pepper. Text the Alvarez household if you spot her.',
   false, now() - interval '11 days'),
  ('5eed0000-0000-4000-8000-000000000001','11110000-0000-4000-8000-000000000009','hoa',
   'February minutes and FY26 budget posted',
   'Both documents are in the Admin tab. Comments close at the April meeting.',
   false, now() - interval '15 days');

alter table announcements enable trigger announcements_guard_trg;

-- ---------- events --------------------------------------------

insert into events (community_id, author_id, title, body, location, starts_at, ends_at)
values
  ('5eed0000-0000-4000-8000-000000000001','11110000-0000-4000-8000-000000000004',
   'Block party on Flintgrove Loop',
   'Potluck, bring a dish to share. Road closed to through traffic from 4pm.',
   'Flintgrove Loop', now() + interval '12 days', now() + interval '12 days 5 hours'),
  ('5eed0000-0000-4000-8000-000000000001','11110000-0000-4000-8000-000000000009',
   'Quarterly HOA meeting',
   'Budget review and landscaping vendor vote.',
   'Clubhouse', now() + interval '26 days', now() + interval '26 days 2 hours');

-- ---------- summary -------------------------------------------

select
  (select count(*) from households)                         as homes,
  (select count(*) from households where status = 'active') as active,
  (select count(*) from memberships)                        as residents,
  (select count(*) from memberships
     where verification_status = 'pending')                 as awaiting_verification,
  (select count(*) from memberships where not show_on_map)  as opted_off_map,
  (select count(*) from services where status = 'approved') as services_live,
  (select count(*) from services where status = 'pending')  as services_queued;
