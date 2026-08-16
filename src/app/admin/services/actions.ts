"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export type Result = { ok: boolean; error?: string };

/**
 * Approve or reject a listing.
 *
 * The rejection reason is required by the database, not just by this schema:
 * a listing that vanishes without explanation reads as a bug to its author,
 * who then posts it again.
 */
export async function decideService(
  serviceId: string,
  approve: boolean,
  reason: string,
): Promise<Result> {
  const parsed = z
    .object({
      serviceId: z.string().uuid(),
      approve: z.boolean(),
      reason: z.string().trim().max(300),
    })
    .safeParse({ serviceId, approve, reason });

  if (!parsed.success) return { ok: false, error: "Check that." };

  if (!parsed.data.approve && parsed.data.reason.length < 3) {
    return { ok: false, error: "Say why — the author will read this." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("decide_service", {
    service_id: parsed.data.serviceId,
    approve: parsed.data.approve,
    reason: parsed.data.reason || null,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/services");
  revalidatePath("/admin");
  return { ok: true };
}
