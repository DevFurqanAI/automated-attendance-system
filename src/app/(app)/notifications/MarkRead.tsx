'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

/**
 * Marks notifications read once the page has actually rendered them.
 *
 * Doing this during the server render instead would be simpler, but it clears
 * the badge for anything the person merely navigated past — and it would run
 * again on every refresh, so an unread item could never survive a mis-click.
 * Here the rule is plainly "you saw it, so it is read".
 */
export function MarkRead({ ids }: { ids: string[] }) {
  const router = useRouter();
  // Effects run twice in development; marking read twice is harmless but the
  // extra refresh is visible, so it is guarded.
  const done = useRef(false);

  useEffect(() => {
    if (done.current || ids.length === 0) return;
    done.current = true;

    void (async () => {
      try {
        await fetch('/api/notifications/read', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids }),
        });
        // Repaint the header so the bell's count drops without a reload.
        router.refresh();
      } catch {
        // An unread badge that lingers is a cosmetic problem; there is nothing
        // useful to tell the reader here.
      }
    })();
  }, [ids, router]);

  return null;
}
