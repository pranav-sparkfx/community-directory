"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient, getViewer } from "@/lib/supabase/server";

/**
 * Claiming an address.
 *
 * All of the enforcement lives in submit_join_request() — it re-derives the
 * caller from auth.uid(), refuses a household that belongs to another
 * community, and never writes memberships.household_id. This action's only
 * jobs are to shape the input and to turn a Postgres error into a sentence a
 * neighbour can read.
 */

const ClaimInput = z
  .object({
    community_id: z.string().uuid(),
    household_id: z.string().uuid().optional(),
    address: z.string().trim().max(160).optional(),
    note: z.string().trim().max(400).optional(),
  })
  .refine((v) => Boolean(v.household_id || v.address), {
    message: "Pick your address, or type it in.",
    path: ["address"],
  });

export type ClaimState = { error?: string; fieldErrors?: Record<string, string> };

export async function submitClaim(
  _prev: ClaimState,
  formData: FormData,
): Promise<ClaimState> {
  const parsed = ClaimInput.safeParse({
    community_id: formData.get("community_id"),
    household_id: formData.get("household_id") || undefined,
    address: formData.get("address") || undefined,
    note: formData.get("note") || undefined,
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      fieldErrors[key] ??= issue.message;
    }
    return { fieldErrors };
  }

  const { user } = await getViewer();
  if (!user) return { error: "Please sign in again." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_join_request", {
    target_community: parsed.data.community_id,
    claimed_household: parsed.data.household_id ?? null,
    claimed_address_text: parsed.data.address ?? null,
    request_note: parsed.data.note ?? null,
  });

  if (error) return { error: error.message };

  revalidatePath("/", "layout");
  redirect("/you");
}

/** Address autocomplete. Returns street addresses only — never residents. */
export async function searchAddresses(
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
