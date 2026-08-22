import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC_PATHS = ['/login', '/auth'];

/**
 * Refreshes the Supabase session on every request and gates the app behind a
 * login.
 *
 * This is the Next.js 16 `proxy` convention — the former `middleware.ts`.
 *
 * `getClaims()` must be awaited *before* the response is returned, otherwise a
 * token refresh that lands after the response is committed loses its cookies
 * and the next request refreshes all over again.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Without configuration there is no session to refresh; let the page render
  // and show its own setup message rather than 500-ing every route.
  if (!supabaseUrl || !supabaseKey) return response;

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        // Stops a CDN caching a response that carries someone's Set-Cookie.
        for (const [key, value] of Object.entries(headers)) {
          response.headers.set(key, value);
        }
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const isSignedIn = Boolean(data?.claims?.sub);

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  if (!isSignedIn && !isPublic) {
    // API routes must answer with JSON. Redirecting them to the login page
    // would hand the client an HTML body that `response.json()` chokes on,
    // turning "your session expired" into an unexplained parse error.
    // The CSV export is exempt: it is a top-level navigation, so a redirect
    // to the login page is the right behaviour there.
    if (pathname.startsWith('/api/') && !pathname.startsWith('/api/hr/reports')) {
      return NextResponse.json(
        { error: 'Your session has expired. Please sign in again.' },
        { status: 401 },
      );
    }

    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  if (isSignedIn && pathname === '/login') {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and the icon/manifest files, which are
     * public by definition and would otherwise pay for a session lookup.
     */
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icons/|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico)$).*)',
  ],
};
