-- Front Porch — Phase 3: identity, claiming an address, and verification.
--
-- Three of these are RPCs rather than table writes, for one reason: the
-- grants matrix (migration 4) never gave `authenticated` update rights on
-- memberships.role, .verification_status or .household_id — not even to
-- admins, because a column grant is global and cannot be narrowed by a
-- policy. Promotion to "verified resident" therefore has exactly one code
-- path, it is SECURITY DEFINER, it re-checks the caller's role itself, and
-- it writes an audit row. That is the whole point: the act that makes a
-- person visible in the directory should be impossible to perform by
-- accident or by a crafted PATCH.

-- ---------- the one self-transition worth allowing ------------
-- The guard trigger from migration 3 refuses every verification_status
-- change by a non-admin, which is correct for the escalations it was
-- written to stop — but it also refuses the harmless one: a person moving
-- their own membership to 'pending' by asking to be verified. 'pending'
-- confers nothing (is_verified_member() tests for 'verified'), so the
-- narrow carve-out below is safe, and without it a resident cannot apply.
create or replace function memberships_guard_privileged_columns()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  -- Self-service: I may move my own membership into the waiting room, and
  -- nothing else. Role, household and the verified_* provenance columns
  -- must all be untouched for this branch to apply.
  if new.profile_id = auth.uid()
     and old.profile_id = auth.uid()
     and new.verification_status = 'pending'
     and old.verification_status in ('unverified', 'rejected')
     and new.role is not distinct from old.role
     and new.household_id is not distinct from old.household_id
     and new.community_id is not distinct from old.community_id
     and new.verified_at is null
     and new.verified_by is null
  then
    return new;
  end if;

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
    if new.profile_id = auth.uid()
       and role_rank(new.role) > role_rank(old.role) then
      raise exception 'self-promotion is not permitted'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

-- ---------- claimable addresses -------------------------------
-- Address autocomplete for someone who is not yet a member.
--
-- The disclosure here is deliberate and narrow: street addresses only,
-- never residents. An address is observable by anyone who walks the
-- street; who lives behind it is not. `taken` says whether anyone has
-- already been verified there, which lets the UI warn "someone already
-- lives here" without naming them.
--
-- Gate: the community must be public, or the caller must already hold a
-- membership row in it (which is what redeeming an invite creates). A
-- private community's address list is not enumerable by a stranger.
create or replace function claimable_addresses(
  target_community uuid,
  q text default ''
)
returns table (id uuid, label text, taken boolean)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select h.id,
         h.address_line1 || coalesce(' ' || h.unit, ''),
         exists (
           select 1 from memberships m
           where m.household_id = h.id
             and m.verification_status = 'verified'
         )
  from households h
  where h.community_id = target_community
    and h.status = 'active'
    and auth.uid() is not null
    and (
      exists (
        select 1 from communities c
        where c.id = target_community and c.visibility = 'public'
      )
      or exists (
        select 1 from memberships m
        where m.community_id = target_community and m.profile_id = auth.uid()
      )
    )
    and (
      q = ''
      or h.address_line1 ilike '%' || q || '%'
      or h.normalized_key like '%' || normalize_address_key(q, null) || '%'
    )
  order by h.address_line1
  limit 25;
$$;

-- ---------- submit a claim ------------------------------------
-- Creates the unverified membership and the pending request together.
--
-- Note what it does NOT do: it never sets memberships.household_id. A
-- claim is an assertion, not a fact. The address only attaches to the
-- person when an admin approves, which is what stops "anyone can claim an
-- address" from being true.
create or replace function submit_join_request(
  target_community uuid,
  claimed_household uuid default null,
  claimed_address_text text default null,
  request_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller uuid := auth.uid();
  existing_status verification_status;
  request_id uuid;
begin
  if caller is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;

  if claimed_household is null and coalesce(trim(claimed_address_text), '') = '' then
    raise exception 'an address is required' using errcode = '22023';
  end if;

  -- A claimed household must belong to the community being joined,
  -- otherwise an id from another neighbourhood would be accepted here and
  -- silently attached on approval.
  if claimed_household is not null and not exists (
    select 1 from households h
    where h.id = claimed_household
      and h.community_id = target_community
      and h.status = 'active'
  ) then
    raise exception 'that address is not in this community' using errcode = '22023';
  end if;

  select m.verification_status into existing_status
  from memberships m
  where m.community_id = target_community and m.profile_id = caller;

  if existing_status = 'verified' then
    raise exception 'you are already a verified member here' using errcode = '23505';
  end if;

  insert into memberships (community_id, profile_id, role, verification_status)
  values (target_community, caller, 'resident', 'pending')
  on conflict (community_id, profile_id)
  do update set verification_status = 'pending', updated_at = now();

  insert into join_requests (
    community_id, profile_id, claimed_household_id, claimed_address, note
  )
  values (
    target_community, caller, claimed_household,
    nullif(trim(coalesce(claimed_address_text, '')), ''), nullif(trim(coalesce(request_note, '')), '')
  )
  on conflict do nothing
  returning id into request_id;

  if request_id is null then
    select jr.id into request_id from join_requests jr
    where jr.community_id = target_community
      and jr.profile_id = caller
      and jr.status = 'pending';
  end if;

  return request_id;
end;
$$;

-- ---------- the admin queue -----------------------------------
-- Admins cannot read applicants through the tables: `profiles` is
-- self-read only by design, so a name has to be handed over deliberately.
-- This is that deliberate hand-over, and it is scoped to people who have
-- actively asked to join.
create or replace function verification_queue(target_community uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select case
    when not has_role_at_or_above(target_community, 'moderator') then '[]'::jsonb
    else coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'request_id', jr.id,
          'profile_id', jr.profile_id,
          'name', p.full_name,
          'email', p.email,
          'claimed_household_id', jr.claimed_household_id,
          'claimed_address', coalesce(
            h.address_line1 || coalesce(' ' || h.unit, ''),
            jr.claimed_address
          ),
          'address_is_known', jr.claimed_household_id is not null,
          'occupied_by_count', coalesce((
            select count(*) from memberships m2
            where m2.household_id = jr.claimed_household_id
              and m2.verification_status = 'verified'
          ), 0),
          'note', jr.note,
          'created_at', jr.created_at
        )
        order by jr.created_at
      )
      from join_requests jr
      join profiles p on p.id = jr.profile_id
      left join households h on h.id = jr.claimed_household_id
      where jr.community_id = target_community
        and jr.status = 'pending'
    ), '[]'::jsonb)
  end;
$$;

-- ---------- the decision --------------------------------------
-- Approval is the moment a person becomes real to the directory: it flips
-- verification, attaches the address, and creates the household_members
-- row that puts their name on the card. Denial is recorded, not deleted —
-- a rejected claim on an address is exactly the history an admin wants
-- when the same address is claimed again.
create or replace function decide_join_request(
  request_id uuid,
  approve boolean,
  reason text default null,
  relationship_in household_relation default 'owner'
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  jr join_requests;
  caller uuid := auth.uid();
begin
  select * into jr from join_requests where id = request_id;
  if jr.id is null then
    raise exception 'request not found' using errcode = 'P0002';
  end if;

  -- 'admin', not 'moderator': the memberships guard trigger demands admin
  -- for privileged columns, so anything less would fail halfway through
  -- and leave the queue looking broken rather than looking refused.
  if not has_role_at_or_above(jr.community_id, 'admin') then
    raise exception 'not authorized to decide residency claims'
      using errcode = '42501';
  end if;

  if jr.status <> 'pending' then
    raise exception 'this request was already decided' using errcode = '23505';
  end if;

  if approve then
    if jr.claimed_household_id is null then
      raise exception 'approve needs a matched address; correct the claim first'
        using errcode = '22023';
    end if;

    update memberships
    set verification_status = 'verified',
        household_id = jr.claimed_household_id,
        verified_at = now(),
        verified_by = caller,
        rejection_reason = null,
        updated_at = now()
    where community_id = jr.community_id and profile_id = jr.profile_id;

    insert into household_members (household_id, profile_id, relationship, is_primary)
    select jr.claimed_household_id, jr.profile_id, relationship_in,
           not exists (
             select 1 from household_members hm
             where hm.household_id = jr.claimed_household_id and hm.is_primary
           )
    on conflict (household_id, profile_id) do nothing;
  else
    update memberships
    set verification_status = 'rejected',
        rejection_reason = nullif(trim(coalesce(reason, '')), ''),
        updated_at = now()
    where community_id = jr.community_id and profile_id = jr.profile_id;
  end if;

  update join_requests
  set status = case when approve then 'approved' else 'rejected' end::request_status,
      decided_by = caller,
      decided_at = now(),
      decision_reason = nullif(trim(coalesce(reason, '')), '')
  where id = request_id;

  perform log_audit(
    jr.community_id,
    case when approve then 'join_request.approve' else 'join_request.reject' end,
    'join_request',
    request_id,
    jsonb_build_object('profile_id', jr.profile_id, 'household_id', jr.claimed_household_id)
  );

  insert into notifications (profile_id, community_id, kind, title, body, link)
  values (
    jr.profile_id, jr.community_id, 'verification',
    case when approve then 'You are in' else 'We could not confirm your address' end,
    case when approve
      then 'Your address was confirmed. The neighbourhood directory is now open to you.'
      else coalesce(nullif(trim(coalesce(reason, '')), ''),
                    'An admin could not confirm you live at the address you claimed.')
    end,
    '/'
  );
end;
$$;

-- ---------- matching a free-text claim ------------------------
-- A private community does not hand its address list to strangers, so a
-- newcomer's first claim is usually typed prose ("14 Heron Ridge Ct").
-- This is how an admin binds that prose to a real pin before approving —
-- separate from the approval itself, so "which house did they mean" and
-- "do I believe them" stay two distinct decisions.
create or replace function match_join_request(
  request_id uuid,
  household uuid
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  jr join_requests;
begin
  select * into jr from join_requests where id = request_id;
  if jr.id is null then
    raise exception 'request not found' using errcode = 'P0002';
  end if;
  if not has_role_at_or_above(jr.community_id, 'admin') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if jr.status <> 'pending' then
    raise exception 'this request was already decided' using errcode = '23505';
  end if;
  if not exists (
    select 1 from households h
    where h.id = household and h.community_id = jr.community_id and h.status = 'active'
  ) then
    raise exception 'that address is not in this community' using errcode = '22023';
  end if;

  update join_requests set claimed_household_id = household where id = request_id;

  perform log_audit(jr.community_id, 'join_request.match', 'join_request', request_id,
                    jsonb_build_object('household_id', household));
end;
$$;

-- ---------- admin dashboard numbers ---------------------------
-- One round trip for the whole header. Each number is the answer to a
-- question an admin actually asks, not a count that happened to be easy:
-- "how many people", "what is waiting on me", "which homes have nobody",
-- "who is new".
create or replace function community_stats(target_community uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select case
    when not has_role_at_or_above(target_community, 'moderator') then '{}'::jsonb
    else jsonb_build_object(
      'residents', (
        select count(*) from memberships m
        where m.community_id = target_community and m.verification_status = 'verified'
      ),
      'pending', (
        select count(*) from join_requests jr
        where jr.community_id = target_community and jr.status = 'pending'
      ),
      'homes_active', (
        select count(*) from households h
        where h.community_id = target_community and h.status = 'active'
      ),
      'homes_occupied', (
        select count(distinct m.household_id) from memberships m
        where m.community_id = target_community
          and m.verification_status = 'verified'
          and m.household_id is not null
      ),
      'new_residents_30d', (
        select count(*) from memberships m
        where m.community_id = target_community
          and m.verification_status = 'verified'
          and m.verified_at > now() - interval '30 days'
      ),
      'services_pending', (
        select count(*) from services s
        where s.community_id = target_community and s.status = 'pending'
      ),
      'reports_open', (
        select count(*) from reports r
        where r.community_id = target_community and r.status = 'open'
      )
    )
  end;
$$;

grant execute on function claimable_addresses(uuid, text)                  to authenticated;
grant execute on function submit_join_request(uuid, uuid, text, text)      to authenticated;
grant execute on function verification_queue(uuid)                         to authenticated;
grant execute on function decide_join_request(uuid, boolean, text, household_relation) to authenticated;
grant execute on function community_stats(uuid)                            to authenticated;
