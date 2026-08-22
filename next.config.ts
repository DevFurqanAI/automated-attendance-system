import type { NextConfig } from 'next';

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
  distDir: process.env.NODE_ENV === 'development' ? '.next-dev' : '.next',
};

export default nextConfig;
