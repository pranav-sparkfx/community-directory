-- Front Porch — one clock for "new this month".
--
-- The map badge counted new neighbours by sending a cutoff computed from the
-- WEB SERVER's clock, while the admin dashboard's community_stats() computed
-- the same figure from the DATABASE's. Two clocks, one question: the badge
-- and the dashboard could legitimately disagree, and nobody would be wrong.
--
-- community_stats() is moderator-gated, so a resident could not simply reuse
-- it. This is the same count, readable by anyone verified in the community.

create or replace function new_neighbour_count(target_community uuid)
returns int
language sql
stable
security definer
set search_path = public, extensions
as $$
  select case
    when is_verified_member(target_community) then (
      select count(*)::int
      from memberships m
      where m.community_id = target_community
        and m.verification_status = 'verified'
        and m.joined_at > now() - interval '30 days'
    )
    else 0
  end;
$$;

grant execute on function new_neighbour_count(uuid) to authenticated;
