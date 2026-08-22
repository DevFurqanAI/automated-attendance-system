import type { MetadataRoute } from 'next';

/**
 * PWA manifest. Staff install this to their home screen and use it like an app
 * — spec §3 rules out native apps, so this is the whole mobile story.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Staff Attendance',
    short_name: 'Attendance',
    description:
      'Check in and out at any branch with QR + GPS verification.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#ffffff',
    theme_color: '#4a7c8c',
    categories: ['business', 'productivity'],
    icons: [
      { src: '/icons/icon-64.png', sizes: '64x64', type: 'image/png' },
      { src: '/icons/icon-96.png', sizes: '96x96', type: 'image/png' },
      { src: '/icons/icon-128.png', sizes: '128x128', type: 'image/png' },
      { src: '/icons/icon-144.png', sizes: '144x144', type: 'image/png' },
      { src: '/icons/icon-152.png', sizes: '152x152', type: 'image/png' },
      { src: '/icons/icon-180.png', sizes: '180x180', type: 'image/png' },
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-256.png', sizes: '256x256', type: 'image/png' },
      { src: '/icons/icon-384.png', sizes: '384x384', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      {
        src: '/icons/maskable-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icons/maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
