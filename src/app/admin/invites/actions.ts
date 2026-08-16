"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export type Result = { ok: boolean; error?: string; code?: string };

const createSchema = z.object({
  communityId: z.string().uuid(),
  role: z.enum(["resident", "moderator", "admin"]),
  email: z.string().trim().email("That email does not look right.").optional().or(z.literal("")),
  householdId: z.string().uuid().nullable(),
  maxUses: z.number().int().min(1).max(500),
  expiresInDays: z.number().int().min(1).max(365),
});

/**
 * Mint an invite.
 *
 * The role ceiling — nobody invites at or above their own rank — is enforced
 * in create_invite(), which reads the caller's rank from the database. This
 * schema only rejects shapes the RPC would have to reject anyway, so the
 * common mistakes come back as a sentence rather than a Postgres error.
 */
export async function createInvite(input: {
  communityId: string;
  role: string;
  email?: string;
  householdId: string | null;
  maxUses: number;
  expiresInDays: number;
}): Promise<Result> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check those details." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_invite", {
    target_community: parsed.data.communityId,
    role_in: parsed.data.role,
    email_in: parsed.data.email || null,
    household_in: parsed.data.householdId,
    max_uses_in: parsed.data.maxUses,
    expires_in_days: parsed.data.expiresInDays,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/invites");
  return { ok: true, code: (data as { code?: string })?.code };
}

export async function revokeInvite(inviteId: string): Promise<Result> {
  const parsed = z.string().uuid().safeParse(inviteId);
  if (!parsed.success) return { ok: false, error: "That is not an invite." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("revoke_invite", { invite_id: parsed.data });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/invites");
  return { ok: true };
}

/** Addresses an invite can be pinned to, so "this house is yours" is one tap. */
export async function lookupAddresses(communityId: string, q: string) {
  const supabase = await createClient();
  const { data } = await supabase.rpc("claimable_addresses", {
    target_community: communityId,
    q,
  });
  return (data ?? []) as { id: string; label: string; taken: boolean }[];
}
