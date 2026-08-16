"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { switchCommunity } from "@/app/communities/actions";
import { createClient } from "@/lib/supabase/server";

/**
 * Spend an invite.
 *
 * Everything that decides whether this is allowed — revoked, expired, spent,
 * addressed to someone else — is checked inside redeem_invite() under a row
 * lock, not here. This action's job is to route the person to the right next
 * screen depending on what the invite turned out to grant.
 */
export async function redeemInvite(code: string): Promise<{
  ok: boolean;
  error?: string;
  next?: string;
}> {
  const parsed = z
    .string()
    .trim()
    .min(4)
    .max(32)
    .safeParse(code);
  if (!parsed.success) return { ok: false, error: "That code does not look right." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("redeem_invite", {
    invite_code: parsed.data,
  });

  if (error) return { ok: false, error: error.message };

  const result = (data ?? {}) as { community_id?: string; verified?: boolean };
  if (result.community_id) await switchCommunity(result.community_id);

  revalidatePath("/", "layout");

  // An invite that named a house has already confirmed where they live, so
  // they land on the map. Anyone else still owes an address.
  return { ok: true, next: result.verified ? "/" : "/join" };
}
