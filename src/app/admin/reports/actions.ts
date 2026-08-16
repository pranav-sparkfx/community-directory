"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export type Result = { ok: boolean; error?: string };

/**
 * Close a report.
 *
 * "remove" takes the content down; "dismiss" leaves it up. Both answer every
 * person who reported the same thing, not just the row that was clicked —
 * that fan-out lives in resolve_report() so it cannot be skipped by a caller.
 */
export async function resolveReport(
  reportId: string,
  action: "dismiss" | "remove",
  note: string,
): Promise<Result> {
  const parsed = z
    .object({
      reportId: z.string().uuid(),
      action: z.enum(["dismiss", "remove"]),
      note: z.string().trim().max(300),
    })
    .safeParse({ reportId, action, note });

  if (!parsed.success) return { ok: false, error: "Check that." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("resolve_report", {
    report_id: parsed.data.reportId,
    action: parsed.data.action,
    note: parsed.data.note || null,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/reports");
  revalidatePath("/admin");
  return { ok: true };
}
