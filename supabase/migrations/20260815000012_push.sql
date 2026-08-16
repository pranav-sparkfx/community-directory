-- Front Porch — Phase 5b: web push.
--
-- The in-app inbox is already the record of what happened; push is only the
-- tap on the shoulder. That split is deliberate and shapes everything below:
-- a push that fails to deliver must never lose the notification, so pushes
-- are drained FROM the notifications table rather than written alongside it.
--
-- Delivery itself cannot happen in Postgres — it needs VAPID signing over
-- HTTPS — so this migration provides the queue and the endpoints, and a
-- server route drains it. Nothing here fails if that route is never
-- deployed: the inbox keeps working and pushed_at simply stays null.

-- ---------- who to push to ------------------------------------
-- One row per browser, not per person: someone with a phone and a laptop has
-- two subscriptions and should be tapped on both. The endpoint is the
-- browser's own opaque URL and is unique by definition.

create table push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles (id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  failed_at  timestamptz
);

create index push_subscriptions_profile_idx on push_subscriptions (profile_id);

alter table push_subscriptions enable row level security;

-- Self-only, and no direct grants at all: subscribing goes through the RPC
-- so the endpoint can never be attached to somebody else's profile_id.
create policy push_subscriptions_self on push_subscriptions
  for select using (profile_id = auth.uid());

grant select on push_subscriptions to authenticated;

-- ---------- what has been pushed ------------------------------
alter table notifications
  add column if not exists pushed_at timestamptz;

comment on column notifications.pushed_at is
  'When a push was attempted for this row. Null means "not yet"; the drain '
  'stamps it whether or not delivery succeeded, because a retry loop on a '
  'dead endpoint would re-tap every working device in the household.';

-- Only unpushed rows are ever scanned, and the index stays small because
-- rows leave it as soon as they are drained.
create index notifications_pending_push_idx
  on notifications (created_at)
  where pushed_at is null;

-- ---------- subscribe / unsubscribe ---------------------------

create or replace function save_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare caller uuid := auth.uid();
begin
  if caller is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;

  if coalesce(trim(p_endpoint), '') = '' or coalesce(trim(p_p256dh), '') = ''
     or coalesce(trim(p_auth), '') = '' then
    raise exception 'incomplete subscription' using errcode = '22023';
  end if;

  -- A browser re-issues the same endpoint after a permission reset, and the
  -- same endpoint can move to a different account on a shared computer, so
  -- the conflict resolution has to reassign profile_id rather than ignore.
  insert into push_subscriptions (profile_id, endpoint, p256dh, auth, user_agent)
  values (caller, trim(p_endpoint), trim(p_p256dh), trim(p_auth), left(coalesce(p_user_agent, ''), 200))
  on conflict (endpoint) do update
  set profile_id = caller,
      p256dh = excluded.p256dh,
      auth = excluded.auth,
      user_agent = excluded.user_agent,
      failed_at = null;
end;
$$;

create or replace function delete_push_subscription(p_endpoint text)
returns void
language sql
security definer
set search_path = public, extensions
as $$
  delete from push_subscriptions
  where endpoint = trim(p_endpoint) and profile_id = auth.uid();
$$;

grant execute on function save_push_subscription(text, text, text, text) to authenticated;
grant execute on function delete_push_subscription(text) to authenticated;

-- ---------- the drain -----------------------------------------
-- Called by the server route with the service key, never by a browser: it
-- returns other people's endpoints by definition, so it is granted to
-- service_role alone and to nobody else.

create or replace function pending_push_batch(batch int default 200)
returns jsonb
language sql
volatile
security definer
set search_path = public, extensions
as $$
  with claimed as (
    update notifications n
    set pushed_at = now()
    where n.id in (
      select id from notifications
      where pushed_at is null
        -- Anything older than a day is stale: waking someone at 7am about
        -- yesterday's hydrant flush is worse than not waking them at all.
        and created_at > now() - interval '1 day'
        and read_at is null
      order by created_at
      limit greatest(least(batch, 500), 1)
      for update skip locked
    )
    returning n.id, n.profile_id, n.title, n.body, n.link
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'notification_id', c.id,
    'title', c.title,
    'body', c.body,
    'link', c.link,
    'endpoint', s.endpoint,
    'p256dh', s.p256dh,
    'auth', s.auth
  )), '[]'::jsonb)
  from claimed c
  join push_subscriptions s on s.profile_id = c.profile_id
  where s.failed_at is null;
$$;

-- A browser that has uninstalled the app answers 404/410 forever. Marking it
-- keeps the batch join from dragging dead endpoints along every run.
create or replace function mark_push_endpoint_dead(p_endpoint text)
returns void
language sql
volatile
security definer
set search_path = public, extensions
as $$
  update push_subscriptions set failed_at = now() where endpoint = p_endpoint;
$$;

revoke execute on function pending_push_batch(int) from public, anon, authenticated;
revoke execute on function mark_push_endpoint_dead(text) from public, anon, authenticated;
grant execute on function pending_push_batch(int) to service_role;
grant execute on function mark_push_endpoint_dead(text) to service_role;
