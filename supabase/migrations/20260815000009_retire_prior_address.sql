-- Front Porch — approving a claim must retire the claimant's old address.
--
-- Found by walking the real flow: a resident who was already listed at one
-- home claimed another, an admin approved it, and the person ended up named
-- on BOTH household cards. memberships.household_id had moved, but the stale
-- household_members row had not — so a neighbour looking at the old address
-- still saw someone who no longer lives there.
--
-- The fix is not a delete. Someone genuinely moved out of that house, and
-- moved_out_at is the column that says so; household_card() already filters
-- on it, so setting it removes the name from the card while leaving the
-- history an admin would want when the address is claimed again.
--
-- Scoped to the community being approved: a person may legitimately be
-- listed in two different neighbourhoods, and this must not touch that.

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

    -- Retire every other listing this person holds in this community.
    update household_members hm
    set moved_out_at = current_date,
        is_primary = false
    from households h
    where hm.profile_id = jr.profile_id
      and hm.household_id = h.id
      and h.community_id = jr.community_id
      and hm.household_id <> jr.claimed_household_id
      and hm.moved_out_at is null;

    insert into household_members (household_id, profile_id, relationship, is_primary)
    select jr.claimed_household_id, jr.profile_id, relationship_in,
           not exists (
             select 1 from household_members hm
             where hm.household_id = jr.claimed_household_id
               and hm.is_primary
               and hm.moved_out_at is null
           )
    on conflict (household_id, profile_id)
    -- Re-approving someone at an address they had left un-retires them
    -- rather than silently doing nothing.
    do update set moved_out_at = null, relationship = excluded.relationship;
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

grant execute on function decide_join_request(uuid, boolean, text, household_relation)
  to authenticated;

-- ---------- people move within the neighbourhood --------------
-- The first cut refused any claim from a verified member, which read as
-- "you are already in" but landed as "you can never change your address".
-- A resident who moves three doors down has to be able to say so.
--
-- Two things change. A verified member may claim a DIFFERENT household —
-- only re-claiming the address they already hold is refused, since that is
-- the no-op. And filing a change of address does not knock them back to
-- 'pending': they still live here, and revoking the directory for the days
-- an admin takes to answer would punish them for being honest.
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
  existing memberships;
  request_id uuid;
begin
  if caller is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;

  if claimed_household is null and coalesce(trim(claimed_address_text), '') = '' then
    raise exception 'an address is required' using errcode = '22023';
  end if;

  if claimed_household is not null and not exists (
    select 1 from households h
    where h.id = claimed_household
      and h.community_id = target_community
      and h.status = 'active'
  ) then
    raise exception 'that address is not in this community' using errcode = '22023';
  end if;

  select * into existing from memberships m
  where m.community_id = target_community and m.profile_id = caller;

  if existing.verification_status = 'verified'
     and claimed_household is not null
     and existing.household_id = claimed_household then
    raise exception 'that is already your confirmed address' using errcode = '23505';
  end if;

  if existing.id is null then
    insert into memberships (community_id, profile_id, role, verification_status)
    values (target_community, caller, 'resident', 'pending');
  elsif existing.verification_status <> 'verified' then
    update memberships set verification_status = 'pending', updated_at = now()
    where id = existing.id;
  end if;

  insert into join_requests (
    community_id, profile_id, claimed_household_id, claimed_address, note
  )
  values (
    target_community, caller, claimed_household,
    nullif(trim(coalesce(claimed_address_text, '')), ''),
    nullif(trim(coalesce(request_note, '')), '')
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

grant execute on function submit_join_request(uuid, uuid, text, text) to authenticated;

-- The one-primary index is partial on `is_primary` alone, so a moved-out
-- primary would still block a new one. Narrow it to people still living
-- there, which is what "the primary resident" was always supposed to mean.
drop index if exists household_members_one_primary;
create unique index household_members_one_primary
  on household_members (household_id)
  where is_primary and moved_out_at is null;

-- Repair the rows the old behaviour already produced: anyone named at an
-- address that is not their membership's address of record, in a community
-- where they hold a membership, has moved.
update household_members hm
set moved_out_at = current_date, is_primary = false
from households h, memberships m
where hm.household_id = h.id
  and m.profile_id = hm.profile_id
  and m.community_id = h.community_id
  and m.household_id is not null
  and m.household_id <> hm.household_id
  and hm.moved_out_at is null;
