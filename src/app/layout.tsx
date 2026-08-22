import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Staff Attendance',
    template: '%s · Staff Attendance',
  },
  description:
    'Multi-branch staff attendance with QR + GPS verified check-in.',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'Attendance',
    statusBarStyle: 'default',
  },
};

export const viewport: Viewport = {
  themeColor: '#4a7c8c',
  width: 'device-width',
  initialScale: 1,
  // Staff use this one-handed outdoors; let them zoom.
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
