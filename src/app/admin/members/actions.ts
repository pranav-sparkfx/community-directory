"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export type Result = { ok: boolean; error?: string };

const roleSchema = z.enum(["resident", "moderator", "admin"]);

/**
 * Role changes and removals.
 *
 * Neither of these asks the caller who they are — set_member_role() and
 * remove_member() re-derive the caller's rank from the database and refuse
 * anything at or above it. That is the whole defence; this file only makes
 * the refusal legible.
 */
export async function setMemberRole(
  communityId: string,
  profileId: string,
  role: string,
): Promise<Result> {
  const parsed = z
    .object({
      communityId: z.string().uuid(),
      profileId: z.string().uuid(),
      role: roleSchema,
    })
    .safeParse({ communityId, profileId, role });

  if (!parsed.success) return { ok: false, error: "That is not a role we hand out." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_member_role", {
    target_community: parsed.data.communityId,
    target_profile: parsed.data.profileId,
    new_role: parsed.data.role,
  });

  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/members");
  return { ok: true };
}

export async function removeMember(
  communityId: string,
  profileId: string,
  reason: string,
): Promise<Result> {
  const parsed = z
    .object({
      communityId: z.string().uuid(),
      profileId: z.string().uuid(),
      reason: z.string().trim().min(3, "Say why — they will see this.").max(300),
    })
    .safeParse({ communityId, profileId, reason });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check that." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_member", {
    target_community: parsed.data.communityId,
    target_profile: parsed.data.profileId,
    reason: parsed.data.reason,
  });

  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/members");
  return { ok: true };
}

export async function searchMembers(communityId: string, q: string, roleFilter: string) {
  const supabase = await createClient();
  const { data } = await supabase.rpc("community_members", {
    target_community: communityId,
    q,
    role_filter: roleFilter,
  });
  return (data ?? []) as unknown[];
}
