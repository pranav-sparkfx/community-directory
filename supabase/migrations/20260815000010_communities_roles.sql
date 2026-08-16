-- Front Porch — Phase 4: communities, sub-communities, invites and roles.
--
-- Everything privileged here is an RPC for the same reason Phase 3 was: the
-- grants matrix hands `authenticated` no INSERT on communities and no UPDATE
-- on memberships.role, and a column grant is global — it cannot be narrowed
-- by a policy. So "make this person a moderator" has exactly one code path,
-- it re-checks the caller itself, and it writes an audit row.
--
-- The rank rules are stated once and enforced everywhere:
--   * you may never change your own role,
--   * you may never grant a role at or above your own rank,
--   * you may never act on someone whose rank is at or above yours,
--   * 'owner' is not grantable at all — it moves only via transfer_ownership.
-- Together these make privilege escalation a closed loop: the only way to
-- become owner is for the sitting owner to hand it over.

-- ============================================================
-- 0. communities: lock the columns that decide who is in charge
-- ============================================================
-- `grant update on communities to authenticated` is table-wide, and the
-- communities_update policy only asks for admin. That let an admin set
-- owner_id = self and out-rank the actual owner. Path and slug are equally
-- load-bearing: has_role_at_or_above() resolves inheritance by ltree
-- containment, so an admin who could rewrite `path` could reparent their
-- own community under someone else's and inherit their neighbourhood.

create or replace function communities_guard_privileged_columns()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  -- The one shape a legitimate handover has, stated as facts about the rows
  -- rather than as a flag an RPC sets — so it holds against a direct UPDATE
  -- from any session, not only against the ones that remembered the flag.
  -- Only the sitting owner may move ownership, and only onto someone already
  -- carrying the owner role here (which transfer_ownership sets first).
  if new.owner_id is distinct from old.owner_id then
    if old.owner_id is distinct from auth.uid() then
      raise exception 'only the current owner can hand over a community'
        using errcode = '42501';
    end if;
    if not exists (
      select 1 from memberships m
      where m.community_id = new.id
        and m.profile_id = new.owner_id
        and m.role = 'owner'
        and m.verification_status = 'verified'
    ) then
      raise exception 'ownership moves only through transfer_ownership()'
        using errcode = '42501';
    end if;
  end if;

  if new.path is distinct from old.path or new.slug is distinct from old.slug then
    raise exception 'a community''s slug and path are fixed once created'
      using errcode = '0A000';
  end if;

  if not has_role_at_or_above(old.id, 'admin') then
    raise exception 'not authorized to edit this community'
      using errcode = '42501';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger communities_guard
  before update on communities
  for each row execute function communities_guard_privileged_columns();

-- ============================================================
-- 1. reading the communities a person belongs to
-- ============================================================
-- The switcher, and the source of truth for "which neighbourhood am I
-- looking at". Includes communities where the caller is only pending:
-- someone waiting on a claim still needs to see the name of the place
-- they are waiting for.

create or replace function my_communities()
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select coalesce(jsonb_agg(x order by x->>'name'), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'id',            c.id,
      'name',          c.name,
      'slug',          c.slug,
      'visibility',    c.visibility,
      'parent_id',     c.parent_id,
      'parent_name',   p.name,
      'depth',         nlevel(c.path),
      'role',          m.role,
      'status',        m.verification_status,
      'is_owner',      c.owner_id = auth.uid(),
      'member_count',  (
        select count(*) from memberships mm
        where mm.community_id = c.id and mm.verification_status = 'verified'
      )
    ) as x
    from memberships m
    join communities c on c.id = m.community_id
    left join communities p on p.id = c.parent_id
    where m.profile_id = auth.uid()
  ) s;
$$;

-- Public communities the caller is not already in. This is the only place
-- a stranger meets a neighbourhood, so it returns the name and the size and
-- nothing else — no addresses, no residents, no map centre.
create or replace function browse_communities(q text default '')
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select coalesce(jsonb_agg(x order by x->>'name'), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'id',           c.id,
      'name',         c.name,
      'parent_name',  p.name,
      'description',  c.description,
      'member_count', (
        select count(*) from memberships mm
        where mm.community_id = c.id and mm.verification_status = 'verified'
      )
    ) as x
    from communities c
    left join communities p on p.id = c.parent_id
    where c.visibility = 'public'
      and auth.uid() is not null
      and not exists (
        select 1 from memberships m
        where m.community_id = c.id and m.profile_id = auth.uid()
      )
      and (coalesce(trim(q), '') = '' or c.name ilike '%' || trim(q) || '%')
    limit 25
  ) s;
$$;

-- The sub-communities under one community, for the admin's structure view.
create or replace function child_communities(target_community uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select coalesce(jsonb_agg(x order by x->>'name'), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'id',           c.id,
      'name',         c.name,
      'visibility',   c.visibility,
      'member_count', (
        select count(*) from memberships mm
        where mm.community_id = c.id and mm.verification_status = 'verified'
      ),
      'home_count',   (
        select count(*) from households h
        where h.community_id = c.id and h.status = 'active'
      )
    ) as x
    from communities c
    where c.parent_id = target_community
      and has_role_at_or_above(target_community, 'moderator')
  ) s;
$$;

-- ============================================================
-- 2. creating a community
-- ============================================================
-- One entry point, two outcomes, because from the resident's side it is one
-- action: "I want a community here." Whether that is granted on the spot or
-- queued for an admin depends on where they are standing, not on which
-- button they found.
--
--   no parent          -> created. Someone has to be able to start the first
--                         neighbourhood, and there is no one above them to ask.
--   parent, caller admin -> created, as a sub-community.
--   parent, caller resident -> filed as a request for the parent's admins.

create or replace function slugify(src text)
returns text
language sql
immutable
as $$
  select nullif(
    substring(
      regexp_replace(regexp_replace(lower(trim(src)), '[^a-z0-9]+', '_', 'g'), '^_+|_+$', '', 'g')
      from 1 for 60
    ),
    ''
  );
$$;

create or replace function propose_community(
  parent uuid,
  proposed_name text,
  note_in text default null,
  visibility_in community_visibility default 'private'
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller uuid := auth.uid();
  clean_name text := nullif(trim(coalesce(proposed_name, '')), '');
  base_slug text;
  final_slug text;
  n int := 1;
  new_id uuid;
  req_id uuid;
  may_create boolean;
begin
  if caller is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;

  if clean_name is null or length(clean_name) < 3 then
    raise exception 'a community needs a name of at least 3 characters'
      using errcode = '22023';
  end if;

  base_slug := slugify(clean_name);
  if base_slug is null then
    raise exception 'that name has no letters or numbers in it' using errcode = '22023';
  end if;

  if parent is not null and not exists (select 1 from communities where id = parent) then
    raise exception 'that parent community does not exist' using errcode = 'P0002';
  end if;

  -- A resident may only propose inside a community they actually belong to.
  if parent is not null and not is_verified_member(parent) then
    raise exception 'you are not a member of that community' using errcode = '42501';
  end if;

  may_create := parent is null or has_role_at_or_above(parent, 'admin');

  if not may_create then
    insert into community_requests (parent_id, requester_id, proposed_name, proposed_slug, note)
    values (parent, caller, clean_name, base_slug,
            nullif(trim(coalesce(note_in, '')), ''))
    returning id into req_id;

    perform log_audit(parent, 'community_request.create', 'community_request', req_id,
                      jsonb_build_object('name', clean_name));

    return jsonb_build_object('status', 'requested', 'request_id', req_id);
  end if;

  -- Slug collides only within a parent, so disambiguate against that scope.
  final_slug := base_slug;
  while exists (
    select 1 from communities c
    where c.slug = final_slug and c.parent_id is not distinct from parent
  ) loop
    n := n + 1;
    final_slug := left(base_slug, 55) || '_' || n;
  end loop;

  insert into communities (parent_id, name, slug, visibility, owner_id, path)
  -- path is overwritten by communities_derive_path; a value is supplied
  -- only because the column is NOT NULL and the trigger fires after the
  -- row is constructed.
  values (parent, clean_name, final_slug, visibility_in, caller, final_slug::ltree)
  returning id into new_id;

  insert into memberships (community_id, profile_id, role, verification_status,
                           verified_at, verified_by)
  values (new_id, caller, 'owner', 'verified', now(), caller);

  perform log_audit(new_id, 'community.create', 'community', new_id,
                    jsonb_build_object('name', clean_name, 'parent_id', parent));

  return jsonb_build_object('status', 'created', 'community_id', new_id);
end;
$$;

-- The queue an admin works: sub-community proposals from residents.
create or replace function community_request_queue(target_community uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select coalesce(jsonb_agg(x order by x->>'created_at'), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'request_id',    cr.id,
      'name',          cr.proposed_name,
      'note',          cr.note,
      'requester',     pr.full_name,
      'requester_id',  cr.requester_id,
      'created_at',    cr.created_at
    ) as x
    from community_requests cr
    join profiles pr on pr.id = cr.requester_id
    where cr.parent_id = target_community
      and cr.status = 'pending'
      and has_role_at_or_above(target_community, 'admin')
  ) s;
$$;

create or replace function decide_community_request(
  request_id uuid,
  approve boolean,
  reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  cr community_requests;
  caller uuid := auth.uid();
  final_slug text;
  n int := 1;
  new_id uuid;
begin
  select * into cr from community_requests where id = request_id;
  if cr.id is null then
    raise exception 'request not found' using errcode = 'P0002';
  end if;

  if not has_role_at_or_above(cr.parent_id, 'admin') then
    raise exception 'not authorized to decide community requests' using errcode = '42501';
  end if;

  if cr.status <> 'pending' then
    raise exception 'this request was already decided' using errcode = '23505';
  end if;

  if approve then
    final_slug := cr.proposed_slug;
    while exists (
      select 1 from communities c
      where c.slug = final_slug and c.parent_id is not distinct from cr.parent_id
    ) loop
      n := n + 1;
      final_slug := left(cr.proposed_slug, 55) || '_' || n;
    end loop;

    insert into communities (parent_id, name, slug, visibility, owner_id, path)
    values (cr.parent_id, cr.proposed_name, final_slug, 'private',
            cr.requester_id, final_slug::ltree)
    returning id into new_id;

    -- The requester runs what they asked for. Anything less means an admin
    -- approves a community and then has to be chased to staff it.
    insert into memberships (community_id, profile_id, role, verification_status,
                             verified_at, verified_by)
    values (new_id, cr.requester_id, 'owner', 'verified', now(), caller);
  end if;

  update community_requests
  set status = case when approve then 'approved' else 'rejected' end::request_status,
      decided_by = caller,
      decided_at = now(),
      decision_reason = nullif(trim(coalesce(reason, '')), ''),
      created_community_id = new_id
  where id = request_id;

  perform log_audit(
    cr.parent_id,
    case when approve then 'community_request.approve' else 'community_request.reject' end,
    'community_request', request_id,
    jsonb_build_object('name', cr.proposed_name, 'created_community_id', new_id)
  );

  insert into notifications (profile_id, community_id, kind, title, body, link)
  values (
    cr.requester_id, coalesce(new_id, cr.parent_id), 'community',
    case when approve then cr.proposed_name || ' is live'
         else 'Your community request was declined' end,
    case when approve
      then 'You are the owner. Invite your neighbours and start adding homes.'
      else coalesce(nullif(trim(coalesce(reason, '')), ''),
                    'An admin declined this request.')
    end,
    case when approve then '/admin' else '/communities' end
  );

  return jsonb_build_object('status', case when approve then 'approved' else 'rejected' end,
                            'community_id', new_id);
end;
$$;

-- ============================================================
-- 3. invites
-- ============================================================
-- One table serves all three shapes the product asks for:
--   link  -> max_uses > 1, no email     (post it in the HOA newsletter)
--   email -> max_uses = 1, email set    (addressed to one person)
--   code  -> the code itself, typed in  (read out at a meeting)
-- They differ only in how the code travels, so they share one redeem path.

create or replace function generate_invite_code()
returns text
language plpgsql
volatile
set search_path = public, extensions
as $$
declare
  -- No I, O, 0 or 1: this code gets read aloud at a residents' meeting and
  -- written on a paper flyer, and those four are where transcription fails.
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  candidate text;
  i int;
begin
  loop
    candidate := '';
    for i in 1..8 loop
      candidate := candidate || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from invites where code = candidate);
  end loop;
  return candidate;
end;
$$;

create or replace function create_invite(
  target_community uuid,
  role_in member_role default 'resident',
  email_in text default null,
  household_in uuid default null,
  max_uses_in int default 1,
  expires_in_days int default 30
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller uuid := auth.uid();
  caller_role member_role;
  new_code text;
  new_id uuid;
begin
  if not has_role_at_or_above(target_community, 'moderator') then
    raise exception 'not authorized to invite people here' using errcode = '42501';
  end if;

  select m.role into caller_role from memberships m
  join communities held on held.id = m.community_id
  join communities target on target.id = target_community
  where m.profile_id = caller
    and m.verification_status = 'verified'
    and target.path <@ held.path
  order by role_rank(m.role) desc
  limit 1;

  if role_in = 'owner' then
    raise exception 'ownership is transferred, not invited' using errcode = '42501';
  end if;

  -- An invite must not be a ladder: minting one that grants a rank at or
  -- above your own is the same escalation as editing your own role row.
  if role_rank(role_in) >= role_rank(caller_role) then
    raise exception 'you cannot invite someone at or above your own role'
      using errcode = '42501';
  end if;

  if max_uses_in < 1 or max_uses_in > 500 then
    raise exception 'an invite may be used between 1 and 500 times' using errcode = '22023';
  end if;

  if email_in is not null and max_uses_in <> 1 then
    raise exception 'an invite addressed to one person is single-use'
      using errcode = '22023';
  end if;

  if household_in is not null then
    if not exists (
      select 1 from households h
      where h.id = household_in and h.community_id = target_community
    ) then
      raise exception 'that address is not in this community' using errcode = '22023';
    end if;
    if max_uses_in <> 1 then
      raise exception 'an invite tied to an address is single-use' using errcode = '22023';
    end if;
  end if;

  new_code := generate_invite_code();

  insert into invites (community_id, code, email, household_id, role,
                       created_by, max_uses, expires_at)
  values (target_community, new_code,
          nullif(lower(trim(coalesce(email_in, ''))), ''),
          household_in, role_in, caller, max_uses_in,
          case when expires_in_days is null then null
               else now() + make_interval(days => expires_in_days) end)
  returning id into new_id;

  perform log_audit(target_community, 'invite.create', 'invite', new_id,
                    jsonb_build_object('role', role_in, 'max_uses', max_uses_in,
                                       'household_id', household_in));

  return jsonb_build_object('id', new_id, 'code', new_code);
end;
$$;

-- The admin's list. Goes through an RPC rather than a plain select because
-- it joins profiles (self-read only under RLS) and households.
create or replace function community_invites(target_community uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'id',         i.id,
      'code',       i.code,
      'email',      i.email,
      'role',       i.role,
      'address',    h.address_line1,
      'max_uses',   i.max_uses,
      'use_count',  i.use_count,
      'expires_at', i.expires_at,
      'revoked_at', i.revoked_at,
      'created_by', pr.full_name,
      'created_at', i.created_at,
      'state', case
        when i.revoked_at is not null then 'revoked'
        when i.expires_at is not null and i.expires_at < now() then 'expired'
        when i.use_count >= i.max_uses then 'used up'
        else 'active'
      end
    ) as x
    from invites i
    join profiles pr on pr.id = i.created_by
    left join households h on h.id = i.household_id
    where i.community_id = target_community
      and has_role_at_or_above(target_community, 'moderator')
    order by i.created_at desc
    limit 100
  ) s;
$$;

create or replace function revoke_invite(invite_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare inv invites;
begin
  select * into inv from invites where id = invite_id;
  if inv.id is null then
    raise exception 'invite not found' using errcode = 'P0002';
  end if;
  if not has_role_at_or_above(inv.community_id, 'moderator') then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  update invites set revoked_at = now() where id = invite_id and revoked_at is null;
  perform log_audit(inv.community_id, 'invite.revoke', 'invite', invite_id, '{}'::jsonb);
end;
$$;

-- What the redeem screen shows BEFORE anyone commits: which neighbourhood
-- is this, and is the code still good. Deliberately readable by a signed-out
-- visitor — the code itself is the credential, and someone has to be able to
-- see what they are being invited to before they create an account.
create or replace function preview_invite(invite_code text)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'community_id',   c.id,
    'community_name', c.name,
    'parent_name',    p.name,
    'role',           i.role,
    'address',        h.address_line1,
    'invited_by',     pr.full_name,
    'email',          i.email,
    'state', case
      when i.revoked_at is not null then 'revoked'
      when i.expires_at is not null and i.expires_at < now() then 'expired'
      when i.use_count >= i.max_uses then 'used up'
      else 'active'
    end
  )
  from invites i
  join communities c on c.id = i.community_id
  join profiles pr on pr.id = i.created_by
  left join communities p on p.id = c.parent_id
  left join households h on h.id = i.household_id
  where i.code = upper(trim(invite_code));
$$;

create or replace function redeem_invite(invite_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller uuid := auth.uid();
  inv invites;
  caller_email text;
  existing memberships;
  verified boolean;
begin
  if caller is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;

  select * into inv from invites where code = upper(trim(invite_code)) for update;
  if inv.id is null then
    raise exception 'that invite code is not valid' using errcode = 'P0002';
  end if;
  if inv.revoked_at is not null then
    raise exception 'that invite was revoked' using errcode = '42501';
  end if;
  if inv.expires_at is not null and inv.expires_at < now() then
    raise exception 'that invite has expired' using errcode = '42501';
  end if;
  if inv.use_count >= inv.max_uses then
    raise exception 'that invite has already been used' using errcode = '42501';
  end if;

  if inv.email is not null then
    select lower(u.email) into caller_email from auth.users u where u.id = caller;
    if caller_email is distinct from lower(inv.email) then
      raise exception 'this invite was sent to a different email address'
        using errcode = '42501';
    end if;
  end if;

  select * into existing from memberships m
  where m.community_id = inv.community_id and m.profile_id = caller;

  if existing.id is not null and existing.verification_status = 'verified' then
    raise exception 'you are already a member here' using errcode = '23505';
  end if;

  -- An invite that names an address IS the admin asserting residency: they
  -- picked the house off their own map. Anything else still has to be
  -- claimed and reviewed, so the person lands on /join instead.
  verified := inv.household_id is not null;

  if existing.id is null then
    insert into memberships (community_id, profile_id, role, verification_status,
                             household_id, verified_at, verified_by)
    values (inv.community_id, caller, inv.role,
            case when verified then 'verified' else 'unverified' end::verification_status,
            inv.household_id,
            case when verified then now() end,
            case when verified then inv.created_by end);
  else
    update memberships
    set role = inv.role,
        verification_status =
          case when verified then 'verified' else verification_status end::verification_status,
        household_id = coalesce(inv.household_id, household_id),
        verified_at = case when verified then now() else verified_at end,
        verified_by = case when verified then inv.created_by else verified_by end,
        rejection_reason = null,
        updated_at = now()
    where id = existing.id;
  end if;

  if verified then
    update household_members hm
    set moved_out_at = current_date, is_primary = false
    from households h
    where hm.profile_id = caller
      and hm.household_id = h.id
      and h.community_id = inv.community_id
      and hm.household_id <> inv.household_id
      and hm.moved_out_at is null;

    insert into household_members (household_id, profile_id, relationship, is_primary)
    select inv.household_id, caller, 'member',
           not exists (
             select 1 from household_members hm
             where hm.household_id = inv.household_id
               and hm.is_primary and hm.moved_out_at is null
           )
    on conflict (household_id, profile_id)
    do update set moved_out_at = null;
  end if;

  insert into invite_redemptions (invite_id, profile_id)
  values (inv.id, caller)
  on conflict (invite_id, profile_id) do nothing;

  update invites set use_count = use_count + 1 where id = inv.id;

  perform log_audit(inv.community_id, 'invite.redeem', 'invite', inv.id,
                    jsonb_build_object('profile_id', caller, 'verified', verified));

  -- Everyone already here finds out someone moved in. This is the "new
  -- neighbour joined" notification the resident brief asks for, and it is
  -- fired here rather than on verification because an invited person is
  -- vouched for by definition.
  if verified then
    insert into notifications (profile_id, community_id, kind, title, body, link)
    select m.profile_id, inv.community_id, 'neighbor',
           'A new neighbour joined',
           coalesce(pr.full_name, 'Someone') || ' just joined the directory.',
           '/'
    from memberships m
    join profiles pr on pr.id = caller
    where m.community_id = inv.community_id
      and m.verification_status = 'verified'
      and m.profile_id <> caller;
  end if;

  return jsonb_build_object(
    'community_id', inv.community_id,
    'verified', verified,
    'role', inv.role
  );
end;
$$;

-- ============================================================
-- 4. members and roles
-- ============================================================

create or replace function community_members(
  target_community uuid,
  q text default '',
  role_filter text default 'all'
)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select coalesce(jsonb_agg(x order by x->>'rank' desc, x->>'name'), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'membership_id', m.id,
      'profile_id',    m.profile_id,
      'name',          pr.full_name,
      'email',         pr.email,
      'role',          m.role,
      'rank',          role_rank(m.role),
      'status',        m.verification_status,
      'address',       h.address_line1,
      'is_owner',      c.owner_id = m.profile_id,
      'is_self',       m.profile_id = auth.uid(),
      'joined_at',     m.joined_at
    ) as x
    from memberships m
    join communities c on c.id = m.community_id
    join profiles pr on pr.id = m.profile_id
    left join households h on h.id = m.household_id
    where m.community_id = target_community
      and has_role_at_or_above(target_community, 'moderator')
      and (role_filter = 'all' or m.role::text = role_filter)
      and (
        coalesce(trim(q), '') = ''
        or pr.full_name ilike '%' || trim(q) || '%'
        or pr.email ilike '%' || trim(q) || '%'
        or h.address_line1 ilike '%' || trim(q) || '%'
      )
    limit 200
  ) s;
$$;

create or replace function set_member_role(
  target_community uuid,
  target_profile uuid,
  new_role member_role
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller uuid := auth.uid();
  caller_rank int;
  target_row memberships;
begin
  if not has_role_at_or_above(target_community, 'admin') then
    raise exception 'not authorized to change roles here' using errcode = '42501';
  end if;

  if target_profile = caller then
    raise exception 'you cannot change your own role' using errcode = '42501';
  end if;

  if new_role = 'owner' then
    raise exception 'use transfer_ownership() to hand over a community'
      using errcode = '42501';
  end if;

  select max(role_rank(m.role)) into caller_rank
  from memberships m
  join communities held on held.id = m.community_id
  join communities target on target.id = target_community
  where m.profile_id = caller
    and m.verification_status = 'verified'
    and target.path <@ held.path;

  select * into target_row from memberships m
  where m.community_id = target_community and m.profile_id = target_profile;

  if target_row.id is null then
    raise exception 'that person is not a member here' using errcode = 'P0002';
  end if;

  if role_rank(target_row.role) >= caller_rank then
    raise exception 'you cannot change the role of someone at or above your own'
      using errcode = '42501';
  end if;

  if role_rank(new_role) >= caller_rank then
    raise exception 'you cannot grant a role at or above your own'
      using errcode = '42501';
  end if;

  update memberships
  set role = new_role, updated_at = now()
  where id = target_row.id;

  -- memberships_audit already records the role change; this row records the
  -- deliberate act, which is what an audit reader is looking for.
  perform log_audit(target_community, 'member.role', 'membership', target_row.id,
                    jsonb_build_object('from', target_row.role, 'to', new_role,
                                       'profile_id', target_profile));

  insert into notifications (profile_id, community_id, kind, title, body, link)
  values (target_profile, target_community, 'role',
          case when role_rank(new_role) > role_rank(target_row.role)
               then 'You are now a ' || new_role::text
               else 'Your role changed' end,
          'An admin set your role in this community to ' || new_role::text || '.',
          '/you');
end;
$$;

create or replace function remove_member(
  target_community uuid,
  target_profile uuid,
  reason text default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller uuid := auth.uid();
  caller_rank int;
  target_row memberships;
begin
  if not has_role_at_or_above(target_community, 'admin') then
    raise exception 'not authorized to remove members here' using errcode = '42501';
  end if;

  if target_profile = caller then
    raise exception 'you cannot remove yourself; transfer the community first'
      using errcode = '42501';
  end if;

  if exists (select 1 from communities where id = target_community and owner_id = target_profile) then
    raise exception 'the owner cannot be removed' using errcode = '42501';
  end if;

  select max(role_rank(m.role)) into caller_rank
  from memberships m
  join communities held on held.id = m.community_id
  join communities target on target.id = target_community
  where m.profile_id = caller
    and m.verification_status = 'verified'
    and target.path <@ held.path;

  select * into target_row from memberships m
  where m.community_id = target_community and m.profile_id = target_profile;

  if target_row.id is null then
    raise exception 'that person is not a member here' using errcode = 'P0002';
  end if;

  if role_rank(target_row.role) >= caller_rank then
    raise exception 'you cannot remove someone at or above your own role'
      using errcode = '42501';
  end if;

  -- Retire, do not delete. Someone moved out; the household history is what
  -- the next resident's claim gets checked against.
  update household_members hm
  set moved_out_at = current_date, is_primary = false
  from households h
  where hm.profile_id = target_profile
    and hm.household_id = h.id
    and h.community_id = target_community
    and hm.moved_out_at is null;

  delete from memberships where id = target_row.id;

  perform log_audit(target_community, 'member.remove', 'membership', target_row.id,
                    jsonb_build_object('profile_id', target_profile,
                                       'role', target_row.role,
                                       'reason', nullif(trim(coalesce(reason, '')), '')));

  insert into notifications (profile_id, community_id, kind, title, body, link)
  values (target_profile, target_community, 'membership',
          'You were removed from a community',
          coalesce(nullif(trim(coalesce(reason, '')), ''),
                   'An admin removed your membership.'),
          '/communities');
end;
$$;

-- Ownership is the one privilege that cannot be granted sideways, so it gets
-- its own routine: the sitting owner names a successor and is demoted to
-- admin in the same transaction. There is always exactly one owner.
create or replace function transfer_ownership(
  target_community uuid,
  new_owner uuid
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller uuid := auth.uid();
  target_row memberships;
begin
  if not exists (
    select 1 from communities where id = target_community and owner_id = caller
  ) then
    raise exception 'only the current owner can transfer a community'
      using errcode = '42501';
  end if;

  if new_owner = caller then
    raise exception 'you already own this community' using errcode = '22023';
  end if;

  select * into target_row from memberships m
  where m.community_id = target_community and m.profile_id = new_owner;

  if target_row.id is null or target_row.verification_status <> 'verified' then
    raise exception 'a community can only be handed to a verified member here'
      using errcode = '22023';
  end if;

  -- Order matters: the guard on communities only lets owner_id move to
  -- someone who already holds the owner role, so the membership rows are
  -- settled first and the communities row follows.
  update memberships set role = 'owner', updated_at = now() where id = target_row.id;
  update memberships set role = 'admin', updated_at = now()
  where community_id = target_community and profile_id = caller;

  update communities set owner_id = new_owner where id = target_community;

  perform log_audit(target_community, 'community.transfer', 'community', target_community,
                    jsonb_build_object('from', caller, 'to', new_owner));

  insert into notifications (profile_id, community_id, kind, title, body, link)
  values (new_owner, target_community, 'role',
          'You now own this community',
          'The previous owner handed it over. You can invite, verify and set roles.',
          '/admin');
end;
$$;

-- ============================================================
-- 5. grants
-- ============================================================

grant execute on function my_communities() to authenticated;
grant execute on function browse_communities(text) to authenticated;
grant execute on function child_communities(uuid) to authenticated;
grant execute on function slugify(text) to authenticated;
grant execute on function propose_community(uuid, text, text, community_visibility) to authenticated;
grant execute on function community_request_queue(uuid) to authenticated;
grant execute on function decide_community_request(uuid, boolean, text) to authenticated;
grant execute on function create_invite(uuid, member_role, text, uuid, int, int) to authenticated;
grant execute on function community_invites(uuid) to authenticated;
grant execute on function revoke_invite(uuid) to authenticated;
grant execute on function redeem_invite(text) to authenticated;
grant execute on function community_members(uuid, text, text) to authenticated;
grant execute on function set_member_role(uuid, uuid, member_role) to authenticated;
grant execute on function remove_member(uuid, uuid, text) to authenticated;
grant execute on function transfer_ownership(uuid, uuid) to authenticated;

-- preview_invite is the one function a signed-out visitor may call: the code
-- is the credential, and someone deciding whether to create an account needs
-- to see which neighbourhood is asking. It returns no addresses and no
-- residents — only the community name and whether the code still works.
grant execute on function preview_invite(text) to authenticated, anon;

-- generate_invite_code is internal to create_invite. Exposing it would let
-- anyone mint codes to probe for collisions.
revoke execute on function generate_invite_code() from public, anon, authenticated;

-- ============================================================
-- 6. reconcile owner_id with the owner role
-- ============================================================
-- From here on, "communities.owner_id" and "the membership row carrying
-- role = owner" are two views of one fact: transfer_ownership writes both,
-- and the guard above refuses a handover unless both agree. A community
-- whose owner_id names someone with no membership in it would therefore be
-- untransferable forever, so any such row is repaired once, here.
--
-- The guard trigger is stood down for the length of this statement: it asks
-- has_role_at_or_above(), which reads auth.uid(), and a migration has no
-- authenticated caller to be.

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
