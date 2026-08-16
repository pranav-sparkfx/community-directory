-- ============================================================
-- Front Porch — plain lng/lat on communities
--
-- PostgREST serialises a PostGIS `geography` column as hex-encoded WKB
-- ("0101000020E6100000..."), not GeoJSON. A client reading
-- `communities.center` therefore gets a truthy STRING, so a
-- `center ? center.coordinates[0] : fallback` guard takes the wrong
-- branch and crashes on undefined rather than falling back.
--
-- Households avoid this because they are only ever read through
-- visible_households() / household_card(), which call st_asgeojson().
-- Communities are read as a plain row, so they need real numbers.
--
-- Generated columns rather than a view: ST_X/ST_Y over a geography cast
-- to geometry is immutable, so Postgres can store the values, and the
-- client gets two ordinary floats with no parsing anywhere.
-- ============================================================

alter table communities
  add column center_lng double precision
    generated always as (st_x(center::geometry)) stored,
  add column center_lat double precision
    generated always as (st_y(center::geometry)) stored;

comment on column communities.center_lng is
  'Longitude of center, for clients. Derived — set `center` instead.';
comment on column communities.center_lat is
  'Latitude of center, for clients. Derived — set `center` instead.';

grant select (id, parent_id, path, name, slug, description, visibility,
              center_lng, center_lat, default_zoom, owner_id,
              created_at, updated_at)
  on communities to authenticated;
