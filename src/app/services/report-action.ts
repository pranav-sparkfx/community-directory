"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

/**
 * File a report.
 *
 * The community is never sent from the client — report_content() derives it
 * from the target itself, so a report cannot be filed into a queue whose
 * moderators cannot see the thing being reported.
 */
export async function reportContent(
  targetType: string,
  targetId: string,
  reason: string,
  detail: string,
): Promise<{ ok: boolean; error?: string }> {
  const parsed = z
    .object({
      targetType: z.enum(["service", "announcement", "event", "profile", "household"]),
      targetId: z.string().uuid(),
      reason: z.string().trim().min(3).max(120),
      detail: z.string().trim().max(500),
    })
    .safeParse({ targetType, targetId, reason, detail });

  if (!parsed.success) return { ok: false, error: "Pick a reason first." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("report_content", {
    p_target_type: parsed.data.targetType,
    p_target_id: parsed.data.targetId,
    p_reason: parsed.data.reason,
    p_detail: parsed.data.detail || null,
  });

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
