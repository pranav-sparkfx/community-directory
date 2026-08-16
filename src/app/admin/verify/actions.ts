"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, getViewer } from "@/lib/supabase/server";

/**
 * The verification decisions.
 *
 * Both call SECURITY DEFINER functions rather than writing tables, because
 * `authenticated` holds no update grant on memberships.verification_status —
 * not even for admins. That is deliberate: promoting someone to "verified
 * resident" is the act that exposes a hundred neighbours' phone numbers to
 * them, so it has exactly one entry point, and that entry point re-checks the
 * caller's role and writes an audit row on its way through.
 */

const Uuid = z.string().uuid();

export async function matchClaim(
  requestId: string,
  householdId: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!Uuid.safeParse(requestId).success || !Uuid.safeParse(householdId).success) {
    return { ok: false, error: "That request is not valid." };
  }
  const { user } = await getViewer();
  if (!user) return { ok: false, error: "Please sign in again." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("match_join_request", {
    request_id: requestId,
    household: householdId,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/verify");
  return { ok: true };
}

export async function decideClaim(
  requestId: string,
  approve: boolean,
  reason?: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!Uuid.safeParse(requestId).success) {
    return { ok: false, error: "That request is not valid." };
  }
  const { user } = await getViewer();
  if (!user) return { ok: false, error: "Please sign in again." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("decide_join_request", {
    request_id: requestId,
    approve,
    reason: reason?.trim() || null,
  });
  if (error) return { ok: false, error: error.message };

  // Approval changes who appears on the map and in every household card.
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Address lookup for matching a typed claim to a real pin. */
export async function lookupAddresses(
  communityId: string,
  query: string,
): Promise<{ id: string; label: string; taken: boolean }[]> {
  if (query.trim().length < 2) return [];
  const supabase = await createClient();
  const { data } = await supabase.rpc("claimable_addresses", {
    target_community: communityId,
    q: query.trim(),
  });
  return (data ?? []) as { id: string; label: string; taken: boolean }[];
}
