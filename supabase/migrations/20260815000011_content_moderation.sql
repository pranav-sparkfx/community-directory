-- Front Porch — Phase 5: announcements, moderation, reports, the audit trail
-- and the notification inbox.
--
-- The split here is deliberate and differs from Phases 3 and 4. Announcements
-- and events are ordinary table writes: the RLS policies already say
-- "moderator or above in this community", which is the whole rule, and an RPC
-- would only restate it. What DOES need a routine is everything where the
-- caller's own privilege is the thing being spent — approving a listing,
-- resolving a report — or where the answer must join `profiles`, which RLS
-- keeps self-only so that a moderation queue cannot double as a way to read
-- the neighbourhood's contact details.

-- ============================================================
-- 1. announcements: who may speak as the HOA
-- ============================================================
-- announcement_kind is not decoration. 'hoa' renders as an official notice
-- from the association; 'neighbor' renders as somebody's post. A moderator
-- exists to clean up content, not to issue dues reminders in the board's
-- name, so the official voice is admin-only.

alter table announcements
  add column if not exists notified_at timestamptz;

comment on column announcements.notified_at is
  'When the inbox fan-out ran. Null on a scheduled post whose publish_at has '
  'not arrived: the trigger is idempotent so a future scheduler can simply '
  're-touch the row.';

create or replace function announcements_guard()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if new.kind = 'hoa' and not has_role_at_or_above(new.community_id, 'admin') then
    raise exception 'only an admin may post in the association''s name'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    new.author_id := coalesce(new.author_id, auth.uid());
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger announcements_guard_trg
  before insert or update on announcements
  for each row execute function announcements_guard();

-- Everyone verified here gets it in their inbox. Fired from a trigger rather
-- than from the composer so a notice posted by any route — a script, a future
-- scheduler, an import — still reaches people.
create or replace function announcements_fan_out()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if new.notified_at is not null or new.publish_at > now() then
    return new;
  end if;

  insert into notifications (profile_id, community_id, kind, title, body, link, payload)
  select m.profile_id, new.community_id, 'announcement',
         new.title,
         left(new.body, 140),
         '/announcements',
         jsonb_build_object('announcement_id', new.id, 'pinned', new.pinned)
  from memberships m
  where m.community_id = new.community_id
    and m.verification_status = 'verified'
    -- The author already knows. A notification about your own post is noise
    -- that trains people to ignore the badge.
    and m.profile_id is distinct from new.author_id;

  update announcements set notified_at = now() where id = new.id;

  perform log_audit(new.community_id, 'announcement.post', 'announcement', new.id,
                    jsonb_build_object('kind', new.kind, 'title', new.title));
  return new;
end;
$$;

create trigger announcements_fan_out_trg
  after insert on announcements
  for each row execute function announcements_fan_out();

-- ============================================================
-- 2. service listings: vet before it is public
-- ============================================================

create or replace function moderation_queue(target_community uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select coalesce(jsonb_agg(x order by x->>'created_at'), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'id',           s.id,
      'title',        s.title,
      'description',  s.description,
      'category',     s.category,
      'category_label', sc.label,
      'availability', s.availability,
      'rate_note',    s.rate_note,
      'author',       pr.full_name,
      'author_id',    s.profile_id,
      'address',      h.address_line1,
      'created_at',   s.created_at,
      -- How many times this author has already been actioned here. A first
      -- listing and a fifth rejected one deserve different attention.
      'prior_rejections', (
        select count(*) from services s2
        where s2.profile_id = s.profile_id
          and s2.community_id = s.community_id
          and s2.status = 'rejected'
      )
    ) as x
    from services s
    join profiles pr on pr.id = s.profile_id
    join service_categories sc on sc.slug = s.category
    left join households h on h.id = s.household_id
    where s.community_id = target_community
      and s.status = 'pending'
      and has_role_at_or_above(target_community, 'moderator')
  ) t;
$$;

create or replace function decide_service(
  service_id uuid,
  approve boolean,
  reason text default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  s services;
  caller uuid := auth.uid();
begin
  select * into s from services where id = service_id;
  if s.id is null then
    raise exception 'listing not found' using errcode = 'P0002';
  end if;

  if not has_role_at_or_above(s.community_id, 'moderator') then
    raise exception 'not authorized to moderate listings here' using errcode = '42501';
  end if;

  -- A moderator approving their own listing is the same conflict as an
  -- applicant approving their own residency claim.
  if s.profile_id = caller then
    raise exception 'someone else has to review your own listing'
      using errcode = '42501';
  end if;

  if not approve and coalesce(trim(reason), '') = '' then
    raise exception 'a rejected listing needs a reason the author can read'
      using errcode = '22023';
  end if;

  update services
  set status = case when approve then 'approved' else 'rejected' end::listing_status,
      decided_by = caller,
      decided_at = now(),
      decision_reason = nullif(trim(coalesce(reason, '')), ''),
      updated_at = now()
  where id = service_id;

  perform log_audit(
    s.community_id,
    case when approve then 'service.approve' else 'service.reject' end,
    'service', service_id,
    jsonb_build_object('title', s.title, 'author_id', s.profile_id,
                       'reason', nullif(trim(coalesce(reason, '')), ''))
  );

  insert into notifications (profile_id, community_id, kind, title, body, link)
  values (
    s.profile_id, s.community_id, 'listing',
    case when approve then 'Your listing is live' else 'Your listing was not approved' end,
    case when approve
      then s.title || ' is now on the services board.'
      else coalesce(nullif(trim(coalesce(reason, '')), ''),
                    'A moderator did not approve this listing.')
    end,
    '/services'
  );
end;
$$;

-- ============================================================
-- 3. reports
-- ============================================================
-- The community is derived from the target rather than taken from the
-- caller: a client that could name both would be able to file a report
-- against content in one community while claiming membership of another,
-- and land it in a queue whose moderators cannot see the thing reported.

create or replace function report_target_community(
  p_target_type text,
  p_target_id uuid
)
returns uuid
language sql
stable
security definer
set search_path = public, extensions
as $$
  select case p_target_type
    when 'service'      then (select community_id from services where id = p_target_id)
    when 'announcement' then (select community_id from announcements where id = p_target_id)
    when 'event'        then (select community_id from events where id = p_target_id)
    when 'household'    then (select community_id from households where id = p_target_id)
    when 'profile'      then (
      -- A person is not "in" one community, so a profile report is filed in
      -- the community the reporter and the reported actually share.
      select m.community_id from memberships m
      where m.profile_id = p_target_id
        and exists (
          select 1 from memberships mine
          where mine.profile_id = auth.uid()
            and mine.community_id = m.community_id
            and mine.verification_status = 'verified'
        )
      limit 1
    )
  end;
$$;

create or replace function report_content(
  p_target_type text,
  p_target_id uuid,
  p_reason text,
  p_detail text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller uuid := auth.uid();
  community uuid;
  new_id uuid;
begin
  if caller is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;

  if p_target_type not in ('service', 'announcement', 'profile', 'household', 'event') then
    raise exception 'that is not something you can report' using errcode = '22023';
  end if;

  if coalesce(trim(p_reason), '') = '' then
    raise exception 'tell the moderators what is wrong' using errcode = '22023';
  end if;

  community := report_target_community(p_target_type, p_target_id);
  if community is null then
    raise exception 'we could not find what you are reporting' using errcode = 'P0002';
  end if;

  if not is_verified_member(community) then
    raise exception 'you can only report content in your own community'
      using errcode = '42501';
  end if;

  -- One open report per person per thing. Without this, a grudge is a
  -- for-loop, and the queue an admin sees stops reflecting how many
  -- separate people were bothered.
  select id into new_id from reports
  where reporter_id = caller
    and target_type = p_target_type
    and target_id = p_target_id
    and status = 'open';

  if new_id is not null then
    return new_id;
  end if;

  insert into reports (community_id, target_type, target_id, reporter_id, reason, detail)
  values (community, p_target_type, p_target_id, caller,
          trim(p_reason), nullif(trim(coalesce(p_detail, '')), ''))
  returning id into new_id;

  return new_id;
end;
$$;

create or replace function reports_queue(target_community uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select coalesce(jsonb_agg(x order by x->>'created_at'), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'id',          r.id,
      'target_type', r.target_type,
      'target_id',   r.target_id,
      'reason',      r.reason,
      'detail',      r.detail,
      'reporter',    pr.full_name,
      'created_at',  r.created_at,
      'summary', case r.target_type
        when 'service'      then (select s.title from services s where s.id = r.target_id)
        when 'announcement' then (select a.title from announcements a where a.id = r.target_id)
        when 'event'        then (select e.title from events e where e.id = r.target_id)
        when 'household'    then (select h.address_line1 from households h where h.id = r.target_id)
        when 'profile'      then (select p2.full_name from profiles p2 where p2.id = r.target_id)
      end,
      -- Three people reporting the same listing is a different situation
      -- from one person reporting it three times, which is why the unique
      -- open report above matters.
      'also_reported_by', (
        select count(*) - 1 from reports r2
        where r2.target_type = r.target_type
          and r2.target_id = r.target_id
          and r2.status = 'open'
      )
    ) as x
    from reports r
    join profiles pr on pr.id = r.reporter_id
    where r.community_id = target_community
      and r.status = 'open'
      and has_role_at_or_above(target_community, 'moderator')
  ) t;
$$;

create or replace function resolve_report(
  report_id uuid,
  action text,
  note text default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  r reports;
  caller uuid := auth.uid();
  removed boolean := false;
begin
  select * into r from reports where id = report_id;
  if r.id is null then
    raise exception 'report not found' using errcode = 'P0002';
  end if;

  if not has_role_at_or_above(r.community_id, 'moderator') then
    raise exception 'not authorized to moderate here' using errcode = '42501';
  end if;

  if action not in ('dismiss', 'remove') then
    raise exception 'a report is either dismissed or acted on' using errcode = '22023';
  end if;

  if action = 'remove' then
    -- Only content is removable from here. A report against a person or a
    -- household is a judgement about someone's membership, and that belongs
    -- on the members screen where the rank rules apply — not to a moderator
    -- clearing a queue.
    if r.target_type = 'service' then
      update services
      set status = 'rejected', decided_by = caller, decided_at = now(),
          decision_reason = coalesce(nullif(trim(coalesce(note, '')), ''),
                                     'Removed after a neighbour reported it.'),
          updated_at = now()
      where id = r.target_id;
      removed := true;
    elsif r.target_type = 'announcement' then
      delete from announcements where id = r.target_id;
      removed := true;
    elsif r.target_type = 'event' then
      delete from events where id = r.target_id;
      removed := true;
    else
      raise exception 'reports about people are handled on the members screen'
        using errcode = '22023';
    end if;
  end if;

  -- Everyone who reported this same thing is answered at once. Resolving
  -- one row and leaving four identical ones open is how a queue rots — and
  -- every one of those people is written back to in the same statement,
  -- because closing someone's report silently is the same as ignoring it.
  -- An earlier cut closed them all and told only the one whose id came in.
  with closed as (
    update reports
    set status = case when action = 'remove' then 'actioned' else 'dismissed' end::report_status,
        resolved_by = caller,
        resolved_at = now(),
        resolution = nullif(trim(coalesce(note, '')), '')
    where target_type = r.target_type
      and target_id = r.target_id
      and community_id = r.community_id
      and status = 'open'
    returning reporter_id
  )
  insert into notifications (profile_id, community_id, kind, title, body, link)
  select distinct c.reporter_id, r.community_id, 'report',
    case when removed then 'Thanks — we took that down' else 'We looked at your report' end,
    coalesce(nullif(trim(coalesce(note, '')), ''),
             case when removed
               then 'A moderator removed the content you reported.'
               else 'A moderator reviewed it and left it up.' end),
    '/'
  from closed c;

  perform log_audit(r.community_id, 'report.' || action, r.target_type, r.target_id,
                    jsonb_build_object('report_id', report_id, 'removed', removed,
                                       'note', nullif(trim(coalesce(note, '')), '')));
end;
$$;

-- ============================================================
-- 4. the audit trail, readable
-- ============================================================
-- audit_log already has an admin-only read policy, but a plain select
-- returns actor UUIDs, and profiles is self-read. This joins the names on
-- the server so the page an admin reads is the page they can act on.

create or replace function audit_feed(
  target_community uuid,
  limit_n int default 60
)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'id',          al.id,
      'action',      al.action,
      'target_type', al.target_type,
      'target_id',   al.target_id,
      'actor',       coalesce(pr.full_name, 'System'),
      'diff',        al.diff,
      'created_at',  al.created_at
    ) as x
    from audit_log al
    left join profiles pr on pr.id = al.actor_id
    where al.community_id = target_community
      and has_role_at_or_above(target_community, 'admin')
    order by al.created_at desc
    limit least(greatest(limit_n, 1), 200)
  ) t;
$$;

-- ============================================================
-- 5. the inbox
-- ============================================================

create or replace function notification_feed(limit_n int default 50)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'id',         n.id,
      'kind',       n.kind,
      'title',      n.title,
      'body',       n.body,
      'link',       n.link,
      'community',  c.name,
      'read',       n.read_at is not null,
      'created_at', n.created_at
    ) as x
    from notifications n
    left join communities c on c.id = n.community_id
    where n.profile_id = auth.uid()
    order by n.created_at desc
    limit least(greatest(limit_n, 1), 200)
  ) t;
$$;

create or replace function unread_notification_count()
returns int
language sql
stable
security definer
set search_path = public, extensions
as $$
  select count(*)::int from notifications
  where profile_id = auth.uid() and read_at is null;
$$;

create or replace function mark_notifications_read(ids uuid[] default null)
returns int
language plpgsql
security definer
set search_path = public, extensions
as $$
declare touched int;
begin
  if auth.uid() is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;

  update notifications
  set read_at = now()
  where profile_id = auth.uid()
    and read_at is null
    and (ids is null or id = any(ids));

  get diagnostics touched = row_count;
  return touched;
end;
$$;

-- ============================================================
-- 6. grants
-- ============================================================

grant execute on function moderation_queue(uuid) to authenticated;
grant execute on function decide_service(uuid, boolean, text) to authenticated;
grant execute on function report_target_community(text, uuid) to authenticated;
grant execute on function report_content(text, uuid, text, text) to authenticated;
grant execute on function reports_queue(uuid) to authenticated;
grant execute on function resolve_report(uuid, text, text) to authenticated;
grant execute on function audit_feed(uuid, int) to authenticated;
grant execute on function notification_feed(int) to authenticated;
grant execute on function unread_notification_count() to authenticated;
grant execute on function mark_notifications_read(uuid[]) to authenticated;

-- One open report per person per thing, enforced in the database and not
-- only in report_content(): the RLS insert policy still allows a direct
-- client insert, and without this a loop could still flood the queue.
create unique index if not exists reports_one_open_per_reporter
  on reports (reporter_id, target_type, target_id)
  where status = 'open';
