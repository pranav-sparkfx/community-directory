import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
  * Refreshes the Supabase session on every request and gates the app routes.
 *
 * Next.js 16.3 renamed the `middleware.ts` convention to `proxy.ts`; the
 * export name changed with it. Behaviour is unchanged.
 *
 * This is a UX boundary, not the security boundary. Even if someone reached a
 * page without a session, RLS returns them nothing — the redirect exists so
 * they see a sign-in screen instead of an empty map.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Must be getUser(), not getSession(): getSession reads the cookie without
  // verifying it, so a forged cookie would pass. getUser revalidates.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic =
    pathname.startsWith("/sign-in") ||
    pathname.startsWith("/auth") ||
    // An invite is the one page a signed-out stranger must be able to read.
    // preview_invite() is granted to `anon` for exactly this: someone
    // deciding whether to create an account has to see which neighbourhood
    // is asking first. It returns the community name and nothing else.
    pathname.startsWith("/invite/") ||
    // Route handlers authenticate themselves — the push drain is called by a
    // scheduler with a shared secret and has no session to redirect to a
    // sign-in page. Any handler added under /api MUST do its own auth; this
    // proxy is a UX boundary and never was the security one.
    pathname.startsWith("/api/") ||
    pathname.startsWith("/styleguide");

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (user && pathname.startsWith("/sign-in")) {
    // Honour ?next=: someone who follows an invite link, signs in, and comes
    // back here with a live session should land on the invite, not be dumped
    // on the map having lost the code. Same-origin paths only — an open
    // redirect on a sign-in page is how a phishing link borrows a domain.
    const requested = request.nextUrl.searchParams.get("next");
    const url = request.nextUrl.clone();
    url.pathname =
      requested && requested.startsWith("/") && !requested.startsWith("//")
        ? requested
        : "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    // Everything except static assets and image files. sw.js is listed
    // explicitly: a service worker redirected to /sign-in registers as an
    // HTML document and every push silently stops arriving. maplibre/ is
    // listed for the same reason — a worker script answered with a redirect
    // to an HTML page fails to parse as a module, and the map loses both its
    // basemap and its pins with nothing in the console.
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|maplibre/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico)$).*)",
  ],
};
