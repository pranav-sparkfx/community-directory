import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser Supabase client.
 *
 * This client carries the anon key and the signed-in user's JWT, so every
 * query it makes runs under RLS as that user. It is deliberately NOT given a
 * service role key — nothing in the browser is ever allowed to bypass the
 * policies, because those policies are the privacy model.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
