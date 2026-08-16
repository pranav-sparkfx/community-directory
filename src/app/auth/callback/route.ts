import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Magic-link landing. Exchanges the one-time code for a session, then sends
 * the resident on to wherever they were headed.
 *
 * `next` is validated as a same-origin path before use — an open redirect
 * here would let a phishing link borrow our domain to bounce someone to an
 * attacker's sign-in page.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const requested = searchParams.get("next") ?? "/";
  const next = requested.startsWith("/") && !requested.startsWith("//") ? requested : "/";

  if (!code) {
    return NextResponse.redirect(`${origin}/sign-in?error=missing_code`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(`${origin}/sign-in?error=link_expired`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
