import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import webpush from "web-push";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Job = {
  notification_id: string;
  title: string;
  body: string | null;
  link: string | null;
  endpoint: string;
  p256dh: string;
  auth: string;
};

/**
 * Deliver queued pushes.
 *
 * Runs on a schedule — Vercel Cron, a Supabase cron job, anything that can
 * make an authenticated POST. It is NOT called from the app: a push is a
 * side effect of a notification already written to the database, and coupling
 * delivery to whichever request happened to create that row would mean a slow
 * push service holding up an admin's "approve" button.
 *
 * Auth is a shared secret in a header rather than a session, because the
 * caller is a machine. It reads other people's push endpoints, so the
 * Supabase client here uses the service key and pending_push_batch() is
 * granted to service_role alone.
 *
 * The batch is claimed by stamping pushed_at inside the RPC before any
 * network call, with FOR UPDATE SKIP LOCKED. Two overlapping cron runs
 * therefore split the work rather than double-tapping everyone.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.PUSH_DRAIN_SECRET;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!secret || !publicKey || !privateKey || !serviceKey) {
    // Deliberately explicit: a silent 200 here would look like "nothing to
    // send" forever, and nobody would notice push was never configured.
    return NextResponse.json(
      { error: "push is not configured on this deployment" },
      { status: 503 },
    );
  }

  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? "mailto:admin@example.com",
    publicKey,
    privateKey,
  );

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.rpc("pending_push_batch", { batch: 200 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const jobs = (data ?? []) as Job[];
  let sent = 0;
  const dead: string[] = [];

  await Promise.all(
    jobs.map(async (job) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: job.endpoint,
            keys: { p256dh: job.p256dh, auth: job.auth },
          },
          JSON.stringify({
            title: job.title,
            body: job.body ?? "",
            link: job.link ?? "/notifications",
            tag: job.notification_id,
          }),
        );
        sent += 1;
      } catch (e) {
        // 404 and 410 mean the browser is gone for good — an uninstalled PWA
        // or a revoked permission. 400 means the stored subscription itself
        // is malformed and will never work. All three are permanent.
        //
        // 403 is deliberately NOT retired: it means the VAPID key does not
        // match the one the subscription was created with, which happens
        // after a key rotation. Treating that as a dead device would quietly
        // unsubscribe the entire neighbourhood over a server config change.
        // A timeout or 5xx is transient and the endpoint stays live.
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 400 || status === 404 || status === 410) dead.push(job.endpoint);
      }
    }),
  );

  await Promise.all(
    dead.map((endpoint) =>
      supabase.rpc("mark_push_endpoint_dead", { p_endpoint: endpoint }),
    ),
  );

  return NextResponse.json({ queued: jobs.length, sent, retired: dead.length });
}
