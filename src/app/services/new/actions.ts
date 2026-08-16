"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient, getViewer } from "@/lib/supabase/server";

/**
 * Resident submits a service listing.
 *
 * A Server Action runs with the same trust level as a public endpoint, so
 * this validates its input and re-checks membership rather than trusting the
 * page that rendered the form.
 *
 * `status` is never accepted from the client. The column grant does not even
 * include it, and the RLS insert policy requires 'pending' — so a listing
 * cannot be published without a moderator, no matter what is posted here.
 */

const ListingInput = z.object({
  category: z.string().min(1).max(64),
  title: z.string().trim().min(3, "Give your listing a short title").max(120),
  description: z.string().trim().max(600).default(""),
  availability: z.string().trim().max(80).optional(),
  rate_note: z.string().trim().max(80).optional(),
});

export type ListingState = { error?: string; fieldErrors?: Record<string, string> };

export async function submitListing(
  _prev: ListingState,
  formData: FormData,
): Promise<ListingState> {
  const parsed = ListingInput.safeParse({
    category: formData.get("category"),
    title: formData.get("title"),
    description: formData.get("description") ?? "",
    availability: formData.get("availability") || undefined,
    rate_note: formData.get("rate_note") || undefined,
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      fieldErrors[key] ??= issue.message;
    }
    return { fieldErrors };
  }

  const { user, membership } = await getViewer();
  if (!user || !membership) return { error: "Please sign in again." };
  if (membership.verification_status !== "verified") {
    return { error: "Your address has not been confirmed yet." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("services").insert({
    community_id: membership.community_id,
    profile_id: user.id,
    household_id: membership.household_id,
    category: parsed.data.category,
    title: parsed.data.title,
    description: parsed.data.description,
    availability: parsed.data.availability ?? null,
    rate_note: parsed.data.rate_note ?? null,
    // status intentionally omitted — the column default is 'pending' and the
    // RLS policy enforces it.
  });

  if (error) return { error: error.message };

  revalidatePath("/services");
  redirect("/services?submitted=1");
}
