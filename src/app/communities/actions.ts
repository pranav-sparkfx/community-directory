"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ACTIVE_COMMUNITY_COOKIE, createClient } from "@/lib/supabase/server";

export type Result = { ok: boolean; error?: string; message?: string };

/**
 * Switching neighbourhoods.
 *
 * The cookie only records a preference — getViewer() re-checks that the
 * caller actually holds a membership there before honouring it, so writing
 * this cookie by hand grants nothing. The membership check here exists to
 * give an honest error instead of a silent no-op.
 */
export async function switchCommunity(communityId: string): Promise<Result> {
  const parsed = z.string().uuid().safeParse(communityId);
  if (!parsed.success) return { ok: false, error: "That is not a community." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  const { data } = await supabase
    .from("memberships")
    .select("id")
    .eq("profile_id", user.id)
    .eq("community_id", parsed.data)
    .maybeSingle();

  if (!data) return { ok: false, error: "You are not a member there." };

  const store = await cookies();
  store.set(ACTIVE_COMMUNITY_COOKIE, parsed.data, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  revalidatePath("/", "layout");
  return { ok: true };
}

const proposeSchema = z.object({
  name: z.string().trim().min(3, "Give it a name of at least 3 characters.").max(80),
  note: z.string().trim().max(500).optional(),
  parentId: z.string().uuid().nullable(),
});

/**
 * Ask for a community. Whether that is granted on the spot or queued for an
 * admin is the database's call, not this form's — the RPC returns which
 * happened and the copy follows.
 */
export async function proposeCommunity(input: {
  name: string;
  note?: string;
  parentId: string | null;
}): Promise<Result & { communityId?: string }> {
  const parsed = proposeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check that name." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("propose_community", {
    parent: parsed.data.parentId,
    proposed_name: parsed.data.name,
    note_in: parsed.data.note ?? null,
  });

  if (error) return { ok: false, error: error.message };

  const result = (data ?? {}) as { status?: string; community_id?: string };
  revalidatePath("/", "layout");

  if (result.status === "created" && result.community_id) {
    await switchCommunity(result.community_id);
    return {
      ok: true,
      communityId: result.community_id,
      message: `${parsed.data.name} is live. You own it.`,
    };
  }

  return {
    ok: true,
    message: "Sent to the admins. You will get a notification either way.",
  };
}

/**
 * Joining a public community.
 *
 * A plain insert, deliberately: the RLS policy already pins it to
 * (self, resident, unverified, no address), which is exactly what joining
 * should grant. The directory stays shut until an address is confirmed, so
 * this is admission to the waiting room, not to the address book.
 */
export async function joinPublicCommunity(communityId: string): Promise<Result> {
  const parsed = z.string().uuid().safeParse(communityId);
  if (!parsed.success) return { ok: false, error: "That is not a community." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  const { error } = await supabase
    .from("memberships")
    .insert({ community_id: parsed.data, profile_id: user.id });

  if (error && error.code !== "23505") return { ok: false, error: error.message };

  await switchCommunity(parsed.data);
  return { ok: true, message: "You are in. Claim your address to see the directory." };
}

export async function searchCommunities(q: string) {
  const supabase = await createClient();
  const { data } = await supabase.rpc("browse_communities", { q });
  return (data ?? []) as {
    id: string;
    name: string;
    parent_name: string | null;
    description: string | null;
    member_count: number;
  }[];
}
