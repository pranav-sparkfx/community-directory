"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

/**
 * Mark the inbox read.
 *
 * Scoped inside the RPC to the caller's own rows, so passing someone else's
 * notification id here changes nothing rather than failing loudly — there is
 * no id to guess your way into.
 */
export async function markRead(ids?: string[]): Promise<{ ok: boolean; error?: string }> {
  const parsed = z.array(z.string().uuid()).optional().safeParse(ids);
  if (!parsed.success) return { ok: false, error: "That is not a notification." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_notifications_read", {
    ids: parsed.data ?? null,
  });

  if (error) return { ok: false, error: error.message };

  // The badge lives in the tab bar on every screen, so the whole layout has
  // to re-render, not just this page.
  revalidatePath("/", "layout");
  return { ok: true };
}
