-- ============================================================
-- Front Porch — a name index for the search overlay
--
-- Until now a pin carried address, unit, kind and a count, and nothing else.
-- That was deliberate: names are governed by is_listed and show_in_directory
-- and belong behind household_card()'s redaction, so widening the pin payload
-- to make names searchable would have moved a privacy decision into the map
-- layer. The search box nonetheless offered to find people, and could not.
--
-- search_index() closes that gap without moving the boundary. It answers one
-- question — "which people may this caller see, and which home is each one
-- at" — using exactly the four predicates household_card() already applies:
--
--   hm.is_listed              the household-level opt-out
--   hm.moved_out_at is null   a former resident is not a neighbour
--   mm.verification_status    unverified means invisible, in both directions
--   mm.show_in_directory      the person-level opt-out
--
-- and then the household gate on top:
--
--   household_is_mapped(h.id) at least one resident consents to the pin
--   h.geo is not null         there is a pin to fly to
--
-- Those last two are not belt-and-braces. household_card() refuses an unmapped
-- household outright, so a name returned from an unmapped home would be a
-- result that opens nothing — a dead row the caller can see but not use. The
-- index and the card must agree about who exists, or search becomes a way to
-- learn that someone lives here without being allowed to look at their entry.
--
-- Contact data is absent by construction. This returns a name and a household
-- id; a phone number still only ever arrives through household_card(), inside
-- a RedactedPhone that carries its own permission.
-- ============================================================

create or replace function search_index(target_community uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select case
    when not is_verified_member(target_community)
      then '[]'::jsonb
    else coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'profile_id',   e.profile_id,
          'name',         e.name,
          'household_id', e.household_id,
          'address',      e.address,
          'unit',         e.unit
        )
        order by e.name
      )
      from (
        select
          hm.profile_id,
          coalesce(nullif(hm.display_name, ''), p.full_name) as name,
          h.id                                               as household_id,
          h.address_line1                                    as address,
          h.unit                                             as unit
        from household_members hm
        join households h   on h.id = hm.household_id
        join profiles p     on p.id = hm.profile_id
        join memberships mm on mm.profile_id = hm.profile_id
                           and mm.community_id = h.community_id
        where h.community_id = target_community
          and h.status = 'active'
          and h.geo is not null
          and hm.is_listed
          and hm.moved_out_at is null
          and mm.verification_status = 'verified'
          and mm.show_in_directory
          and coalesce(nullif(hm.display_name, ''), p.full_name) is not null
          and household_is_mapped(h.id)
        -- Mirrors the cap on visible_households(). A community large enough to
        -- hit it has bigger problems than a truncated index, but neither call
        -- may stream without bound.
        order by coalesce(nullif(hm.display_name, ''), p.full_name)
        limit 5000
      ) e
    ), '[]'::jsonb)
  end;
$$;

grant execute on function search_index(uuid) to authenticated;
