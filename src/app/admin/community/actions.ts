"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export type Result = { ok: boolean; error?: string; message?: string };

const detailsSchema = z.object({
  communityId: z.string().uuid(),
  name: z.string().trim().min(3, "A community needs a name.").max(80),
  description: z.string().trim().max(300).nullable(),
  visibility: z.enum(["public", "private"]),
});

/**
 * Name, blurb and who can find this place.
 *
 * A plain table update, and that is deliberate: the communities guard
 * trigger refuses owner_id, slug and path from any statement and demands
 * admin for the rest, so RLS plus the trigger already say everything an RPC
 * here would repeat.
 */
export async function updateCommunity(input: {
  communityId: string;
  name: string;
  description: string | null;
  visibility: string;
}): Promise<Result> {
  const parsed = detailsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check those details." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("communities")
    .update({
      name: parsed.data.name,
      description: parsed.data.description || null,
      visibility: parsed.data.visibility,
    })
    .eq("id", parsed.data.communityId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/", "layout");
  return { ok: true, message: "Saved." };
}

export async function decideCommunityRequest(
  requestId: string,
  approve: boolean,
  reason: string,
): Promise<Result> {
  const parsed = z
    .object({
      requestId: z.string().uuid(),
      approve: z.boolean(),
      reason: z.string().trim().max(300),
    })
    .safeParse({ requestId, approve, reason });

  if (!parsed.success) return { ok: false, error: "Check that." };

  if (!parsed.data.approve && parsed.data.reason.length < 3) {
    return { ok: false, error: "Say why — the person who asked will read it." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("decide_community_request", {
    request_id: parsed.data.requestId,
    approve: parsed.data.approve,
    reason: parsed.data.reason || null,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/community");
  return {
    ok: true,
    message: approve ? "Created. They own it now." : "Declined, and they were told.",
  };
}

/**
 * Hand the community over.
 *
 * Irreversible from the giver's side — only the new owner can hand it back —
 * so the UI asks for the successor's name to be typed out before this runs.
 */
export async function transferOwnership(
  communityId: string,
  newOwnerId: string,
): Promise<Result> {
  const parsed = z
    .object({ communityId: z.string().uuid(), newOwnerId: z.string().uuid() })
    .safeParse({ communityId, newOwnerId });
  if (!parsed.success) return { ok: false, error: "Pick a member first." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("transfer_ownership", {
    target_community: parsed.data.communityId,
    new_owner: parsed.data.newOwnerId,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/", "layout");
  return { ok: true, message: "Handed over. You are an admin here now." };
}
