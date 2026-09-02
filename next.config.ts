import type { NextConfig } from 'next';

/**
 * Content-Security-Policy.
 *
 * `script-src` keeps 'unsafe-inline'. Next.js bootstraps hydration with inline
 * <script> tags; removing it means minting a per-request nonce in the proxy and
 * threading it through every render, which is a real change to how pages are
 * served — worth doing, but not something to switch on silently. The directive
 * still earns its place: it pins script loading to this origin, so an injected
 * <script src="//evil"> is blocked even though an inline one would not be.
 *
 * 'unsafe-eval' is dev-only — the Turbopack dev runtime needs it, production
 * does not.
 *
 * 'wasm-unsafe-eval' is always on: QrScanner falls back to the
 * `barcode-detector` ponyfill (zxing-wasm) on browsers without a native
 * BarcodeDetector, and compiling that WASM module is blocked without it —
 * separate from, and much narrower than, 'unsafe-eval' (it permits
 * WebAssembly compilation only, not arbitrary string-to-JS).
 *
 * `connect-src` must include Supabase over both https and wss: the browser
 * client talks to PostgREST and Auth directly, and the HR dashboard holds a
 * realtime websocket open for the review queue.
 */
function contentSecurityPolicy(isDev: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${isDev ? " 'unsafe-eval'" : ''}`,
    // Tailwind ships as a stylesheet, but Next still inlines critical CSS.
    "style-src 'self' 'unsafe-inline'",
    // data: for the generated QR PNGs, blob: for the camera frames the scanner
    // draws before decoding them.
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
    // The QR scanner decodes camera frames in a worker.
    "worker-src 'self' blob:",
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // Clickjacking: nothing here should ever be framed, and an attendance
    // approve button is exactly the sort of thing worth framing invisibly.
    "frame-ancestors 'none'",
    ...(isDev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
}

const isDev = process.env.NODE_ENV === 'development';

const nextConfig: NextConfig = {
  /*
   * Keep `next dev` and `next build` in separate output directories.
   *
   * Both default to `.next`. Running a production build while a dev server is
   * live overwrites the manifests the dev server is reading, and the symptom is
   * baffling: already-compiled routes keep working while every route the dev
   * server had not yet compiled starts returning 404 — with nothing in the log.
   *
   * Production stays on `.next` so Vercel's build output is exactly where it
   * expects to find it; only dev moves aside.
   */
  distDir: isDev ? '.next-dev' : '.next',

  async headers() {
    return [
      {
        // Every route, including the API and the QR image endpoint.
        source: '/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: contentSecurityPolicy(isDev),
          },
          {
            // Two years, preloadable. Vercel serves HTTPS only, and the camera
            // and GPS this app depends on refuse to start off a plain-HTTP
            // origin anyway, so there is nothing to lose by pinning it.
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          {
            // Keep branch ids and record ids out of the Referer on any outbound
            // link, while still sending the origin for same-site navigation.
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            // Camera and geolocation are the two capabilities this app cannot
            // work without — everything else is denied outright, so a
            // compromised dependency cannot quietly reach for the microphone.
            key: 'Permissions-Policy',
            value: [
              'camera=(self)',
              'geolocation=(self)',
              'microphone=()',
              'payment=()',
              'usb=()',
              'interest-cohort=()',
            ].join(', '),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
