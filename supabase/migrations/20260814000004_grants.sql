-- ============================================================
-- Front Porch — explicit privilege matrix for `authenticated`
--
-- Supabase's default privileges never applied to the tables created in
-- migration 1, so `authenticated` held no DML on any of them. RLS
-- policies are inert without a base grant, which meant migration 2's
-- 36 policies were guarding doors that had no floor.
--
-- Rather than restore blanket `grant all`, this states each privilege
-- deliberately. Two rules:
--   1. No table gets INSERT unless a client legitimately creates rows
--      there directly. Membership verification, community creation and
--      invite redemption are RPC-only, so those tables get no INSERT.
--   2. Where a column confers privilege or leaks operational data,
--      the grant is column-scoped, so RLS is not the only thing
--      standing between a client and that column.
-- ============================================================

-- ---------- profiles ------------------------------------------
-- Self-only by RLS. Raw phone/email live here and are reachable only by
-- their owner; neighbors see contact data solely through household_card().
grant select, insert, update on profiles to authenticated;

-- ---------- communities ---------------------------------------
-- No INSERT: creation consumes an approved community_requests row inside
-- a SECURITY DEFINER RPC (Phase 4). No DELETE: owner-only, and routed
-- through an RPC so it can be audited and soft-deleted.
grant select, update on communities to authenticated;

-- ---------- households ----------------------------------------
-- `notes`, `normalized_key` and `merged_into_id` are withheld at the
-- column level. notes is where an admin records "renter", "kids home
-- alone after 3pm" — it must not be column-readable by neighbors.
grant select (id, community_id, address_line1, unit, city, state,
              postal_code, geo, photo_path, status, created_at, updated_at)
  on households to authenticated;
grant update (address_line1, unit, city, state, postal_code, geo, photo_path)
  on households to authenticated;
grant insert, delete on households to authenticated;  -- gated to admins by RLS

-- ---------- household_members ---------------------------------
-- No INSERT. Attaching a person to a household is exactly the move that
-- let an attacker inherit edit rights over a neighbor's address, so it
-- happens only through the invite / join-request RPC (Phase 3).
grant select, update, delete on household_members to authenticated;

-- ---------- memberships ---------------------------------------
-- INSERT is column-scoped to (community_id, profile_id): a client cannot
-- even name `role` or `verification_status`, so the column defaults
-- ('resident', 'unverified') are what the RLS WITH CHECK then validates.
-- UPDATE is column-scoped to the four privacy settings — turning your own
-- visibility down must always succeed, and nothing else is reachable.
grant select on memberships to authenticated;
grant insert (community_id, profile_id) on memberships to authenticated;
grant update (phone_vis, email_vis, show_on_map, show_in_directory)
  on memberships to authenticated;

-- ---------- access requests -----------------------------------
grant select, insert, update, delete on invites to authenticated;  -- admin-gated by RLS
grant select on invite_redemptions to authenticated;               -- redemption is an RPC

-- `status`, `decided_by`, `decided_at` withheld: a requester approving
-- their own request would forge the very proof the verification RPC trusts.
grant select on join_requests to authenticated;
grant insert (community_id, profile_id, claimed_household_id, claimed_address, note)
  on join_requests to authenticated;
grant update (note, status) on join_requests to authenticated;  -- withdraw only, per RLS

grant select on community_requests to authenticated;
grant insert (parent_id, requester_id, proposed_name, proposed_slug, note)
  on community_requests to authenticated;
grant update (note, status) on community_requests to authenticated;

-- ---------- content -------------------------------------------
grant select, insert, update, delete on announcements to authenticated;
grant select, insert, update, delete on events to authenticated;
grant select on service_categories to authenticated;

-- `status`/`decided_by`/`decided_at` withheld so an author cannot publish
-- past moderation; the services_guard trigger also re-queues edited listings.
grant select on services to authenticated;
grant insert (community_id, profile_id, household_id, category, title,
              description, availability, rate_note) on services to authenticated;
grant update (category, title, description, availability, rate_note, status)
  on services to authenticated;
grant delete on services to authenticated;

-- ---------- moderation & operations ---------------------------
grant select on reports to authenticated;
grant insert (community_id, target_type, target_id, reporter_id, reason, detail)
  on reports to authenticated;
grant update (status, resolved_by, resolved_at, resolution)
  on reports to authenticated;  -- moderator-gated by RLS

-- No INSERT: notifications are produced server-side. A client marks read.
grant select on notifications to authenticated;
grant update (read_at) on notifications to authenticated;
grant delete on notifications to authenticated;

-- Read-only, admin-gated by RLS. No INSERT at any level: audit rows come
-- from SECURITY DEFINER routines and triggers, so an actor cannot forge
-- or suppress their own trail.
grant select on audit_log to authenticated;

-- ---------- anon gets nothing ---------------------------------
-- Every read in this product requires an authenticated, verified member.
revoke all on all tables in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
