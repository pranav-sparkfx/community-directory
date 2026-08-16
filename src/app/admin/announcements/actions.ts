"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, getViewer } from "@/lib/supabase/server";

export type Result = { ok: boolean; error?: string; message?: string };

const announcementSchema = z.object({
  communityId: z.string().uuid(),
  kind: z.enum(["hoa", "neighbor"]),
  title: z.string().trim().min(4, "Give it a headline people can scan.").max(120),
  body: z.string().trim().max(4000),
  pinned: z.boolean(),
});

/**
 * Post a notice.
 *
 * A plain insert: announcements_write already restricts this to moderators
 * and above, and the guard trigger refuses `kind = 'hoa'` from anyone below
 * admin. The inbox fan-out is an AFTER INSERT trigger, so a notice posted by
 * any route — this form, a script, an import — still reaches people.
 */
export async function postAnnouncement(input: {
  kind: string;
  title: string;
  body: string;
  pinned: boolean;
}): Promise<Result> {
  const { membership } = await getViewer();
  if (!membership) return { ok: false, error: "You are not in a community." };

  const parsed = announcementSchema.safeParse({
    ...input,
    communityId: membership.community_id,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check that." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("announcements").insert({
    community_id: parsed.data.communityId,
    kind: parsed.data.kind,
    title: parsed.data.title,
    body: parsed.data.body,
    pinned: parsed.data.pinned,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/", "layout");
  return { ok: true, message: "Posted. Everyone verified here has it in their inbox." };
}

const eventSchema = z.object({
  communityId: z.string().uuid(),
  title: z.string().trim().min(4, "Give the event a name.").max(120),
  body: z.string().trim().max(2000),
  location: z.string().trim().max(160).optional(),
  startsAt: z.string().min(1, "When is it?"),
  endsAt: z.string().optional(),
});

export async function postEvent(input: {
  title: string;
  body: string;
  location?: string;
  startsAt: string;
  endsAt?: string;
}): Promise<Result> {
  const { membership } = await getViewer();
  if (!membership) return { ok: false, error: "You are not in a community." };

  const parsed = eventSchema.safeParse({
    ...input,
    communityId: membership.community_id,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check that." };
  }

  const starts = new Date(parsed.data.startsAt);
  const ends = parsed.data.endsAt ? new Date(parsed.data.endsAt) : null;
  if (Number.isNaN(starts.getTime())) return { ok: false, error: "That start time is not a date." };
  if (ends && ends < starts) {
    return { ok: false, error: "It cannot finish before it starts." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("events").insert({
    community_id: parsed.data.communityId,
    title: parsed.data.title,
    body: parsed.data.body,
    location: parsed.data.location || null,
    starts_at: starts.toISOString(),
    ends_at: ends?.toISOString() ?? null,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/", "layout");
  return { ok: true, message: "On the calendar." };
}

export async function setPinned(id: string, pinned: boolean): Promise<Result> {
  const parsed = z
    .object({ id: z.string().uuid(), pinned: z.boolean() })
    .safeParse({ id, pinned });
  if (!parsed.success) return { ok: false, error: "That is not a notice." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("announcements")
    .update({ pinned: parsed.data.pinned })
    .eq("id", parsed.data.id);

  if (error) return { ok: false, error: error.message };
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Take a notice down.
 *
 * A hard delete, unlike almost everything else here. An announcement has no
 * history worth keeping once it is wrong — a mistaken emergency alert should
 * stop being readable, not be archived — and the audit row recording who
 * posted it survives the row itself.
 */
export async function deleteAnnouncement(id: string): Promise<Result> {
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) return { ok: false, error: "That is not a notice." };

  const supabase = await createClient();
  const { error } = await supabase.from("announcements").delete().eq("id", parsed.data);

  if (error) return { ok: false, error: error.message };
  revalidatePath("/", "layout");
  return { ok: true, message: "Taken down." };
}

export async function deleteEvent(id: string): Promise<Result> {
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) return { ok: false, error: "That is not an event." };

  const supabase = await createClient();
  const { error } = await supabase.from("events").delete().eq("id", parsed.data);

  if (error) return { ok: false, error: error.message };
  revalidatePath("/", "layout");
  return { ok: true, message: "Removed from the calendar." };
}
