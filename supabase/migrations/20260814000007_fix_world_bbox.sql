-- ============================================================
-- Front Porch — make the viewport filter optional
--
-- visible_households() defaulted its bbox to the whole world
-- (-180,-90,180,90). st_makeenvelope() on those bounds cast to geography
-- is a degenerate polygon, and PostGIS rejects it outright:
--
--   XX000: Antipodal (180 degrees long) edge detected!
--
-- So the very first call the app makes — "give me every pin in this
-- community" — failed. A geography envelope is only meaningful for a real
-- viewport.
--
-- The bbox is now nullable and the spatial test sits inside a CASE, which
-- Postgres evaluates lazily: with no bbox the envelope is never built at
-- all, rather than built and discarded.
-- ============================================================

drop function if exists visible_households(
  uuid, double precision, double precision, double precision, double precision
);

create or replace function visible_households(
  target_community uuid,
  min_lng double precision default null,
  min_lat double precision default null,
  max_lng double precision default null,
  max_lat double precision default null
)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select case
    when not is_verified_member(target_community)
      then jsonb_build_object('type','FeatureCollection','features','[]'::jsonb)
    else (
      select jsonb_build_object(
        'type', 'FeatureCollection',
        'features', coalesce(jsonb_agg(f.feature), '[]'::jsonb)
      )
      from (
        select jsonb_build_object(
          'type', 'Feature',
          'id', h.id,
          'geometry', st_asgeojson(h.geo)::jsonb,
          'properties', jsonb_build_object(
            'id', h.id,
            'address', h.address_line1,
            'unit', h.unit,
            'kind', case
              when exists (select 1 from services s
                           where s.household_id = h.id and s.status = 'approved')
              then 'service' else 'default' end,
            'resident_count', (
              select count(*) from household_members hm
              join memberships mm on mm.profile_id = hm.profile_id
                                 and mm.community_id = h.community_id
              where hm.household_id = h.id
                and hm.is_listed
                and hm.moved_out_at is null
                and mm.verification_status = 'verified'
                and mm.show_in_directory
            )
          )
        ) as feature
        from households h
        where h.community_id = target_community
          and h.status = 'active'
          and h.geo is not null
          and case
                when min_lng is null or min_lat is null
                  or max_lng is null or max_lat is null
                then true
                else st_intersects(
                  h.geo,
                  st_makeenvelope(min_lng, min_lat, max_lng, max_lat, 4326)::geography
                )
              end
          and household_is_mapped(h.id)
        limit 5000  -- a whole-community call must not stream without bound
      ) f
    )
  end;
$$;

grant execute on function visible_households(
  uuid, double precision, double precision, double precision, double precision
) to authenticated;
