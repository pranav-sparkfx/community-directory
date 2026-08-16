"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, getViewer } from "@/lib/supabase/server";

/**
 * Privacy settings.
 *
 * The update is a plain table write, not an RPC, and that is the point: the
 * grants matrix gives `authenticated` update rights on exactly these four
 * columns of memberships and nothing else. A crafted PATCH that also set
 * `role` or `verification_status` would be refused by Postgres itself before
 * any policy ran, so this action does not have to be the thing that catches
 * it. Zod here is about rejecting nonsense, not about holding the line.
 */

const PrivacyPatch = z.object({
  phone_vis: z.enum(["hidden", "text_only", "call_and_text"]).optional(),
  email_vis: z.enum(["hidden", "visible"]).optional(),
  show_on_map: z.boolean().optional(),
  show_in_directory: z.boolean().optional(),
});

export type PrivacyPatch = z.infer<typeof PrivacyPatch>;

export async function updatePrivacy(
  patch: PrivacyPatch,
): Promise<{ ok: boolean; error?: string }> {
  const parsed = PrivacyPatch.safeParse(patch);
  if (!parsed.success) return { ok: false, error: "That setting is not valid." };
  if (Object.keys(parsed.data).length === 0) return { ok: true };

  const { user, membership } = await getViewer();
  if (!user || !membership) return { ok: false, error: "Please sign in again." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("memberships")
    .update(parsed.data)
    .eq("id", membership.id);

  if (error) return { ok: false, error: error.message };

  // The map, the household cards and the services list all read these
  // settings, so a change has to invalidate more than this page.
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Whether this person is named on their household's card.
 *
 * Separate from the privacy block above because it lives on a different table
 * for a real reason: `is_listed` is a fact about a person at an address, and
 * someone can live at two addresses. Hiding yourself at one should not hide
 * you at the other.
 */
export async function updateListing(
  isListed: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const { user, membership } = await getViewer();
  if (!user || !membership?.household_id) {
    return { ok: false, error: "You are not attached to a home yet." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("household_members")
    .update({ is_listed: isListed })
    .eq("household_id", membership.household_id)
    .eq("profile_id", user.id);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/", "layout");
  return { ok: true };
}
