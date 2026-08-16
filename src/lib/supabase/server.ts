import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Server Supabase client, scoped to the request's session cookies.
 *
 * Server Components cannot write cookies, so the setAll handler swallows the
 * error there — the middleware refreshes the session on every request, which
 * is what keeps the token current.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component. The middleware handles refresh.
          }
        },
      },
    },
  );
}

/**
 * The caller's identity and role in a community, resolved server-side.
 *
 * Role is read from the database rather than from the JWT: a token is issued
 * once and lives for an hour, so a role revoked in that window would still be
 * honoured if we trusted the claim. RLS would still block the write, but the
 * UI would offer controls that then fail — worse than not offering them.
 */
export const ACTIVE_COMMUNITY_COOKIE = "fp_community";

export async function getViewer(communityId?: string) {
  const supabase = await createClient();
  const [
    {
      data: { user },
    },
    cookieStore,
  ] = await Promise.all([supabase.auth.getUser(), cookies()]);

  if (!user) return { user: null, membership: null, isStaff: false, memberships: [] };

  const { data } = await supabase
    .from("memberships")
    // Kept as one string literal on purpose: supabase-js infers the row type
    // from the literal, and a concatenated expression degrades every caller's
    // `membership` to an error type.
    .select("id, community_id, household_id, role, verification_status, phone_vis, email_vis, show_on_map, show_in_directory")
    .eq("profile_id", user.id)
    .order("joined_at", { ascending: true });

  const memberships = data ?? [];

  // Which neighbourhood is this person looking at? The explicit argument
  // wins, then the cookie the switcher writes, then the oldest membership.
  // The cookie is never trusted on its own: it is only honoured when it
  // names a community this person actually belongs to, so pasting someone
  // else's community id into it selects nothing.
  const requested = communityId ?? cookieStore.get(ACTIVE_COMMUNITY_COOKIE)?.value;
  const membership =
    memberships.find((m) => m.community_id === requested) ?? memberships[0] ?? null;

  const isStaff =
    membership?.role === "moderator" ||
    membership?.role === "admin" ||
    membership?.role === "owner";

  return { user, membership, isStaff, memberships };
}
