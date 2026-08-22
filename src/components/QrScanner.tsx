'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Camera QR scanner.
 *
 * Uses the native `BarcodeDetector` where the browser has it (Chrome/Android,
 * Safari 17+), falling back to the `barcode-detector` ponyfill everywhere else.
 * The ponyfill is imported dynamically so its WASM payload only downloads on
 * browsers that actually need it.
 */

type Detector = {
  detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]>;
};

const SCAN_INTERVAL_MS = 250;

async function createDetector(): Promise<Detector> {
  const native = (
    globalThis as unknown as {
      BarcodeDetector?: new (o: { formats: string[] }) => Detector;
    }
  ).BarcodeDetector;

  if (native) {
    try {
      return new native({ formats: ['qr_code'] });
    } catch {
      // Falls through to the ponyfill.
    }
  }

  const { BarcodeDetector } = await import('barcode-detector/ponyfill');
  return new BarcodeDetector({ formats: ['qr_code'] }) as unknown as Detector;
}

export function QrScanner({
  onScan,
  onError,
  paused = false,
}: {
  onScan: (value: string) => void;
  onError?: (message: string) => void;
  paused?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Kept in refs so the scan loop never restarts (and never re-requests the
  // camera) just because the parent re-rendered with a new callback identity.
  // Written in an effect, not during render — a ref mutated mid-render can be
  // discarded when React replays the render.
  const onScanRef = useRef(onScan);
  const pausedRef = useRef(paused);

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  const report = useCallback(
    (message: string) => {
      setError(message);
      onError?.(message);
    },
    [onError],
  );

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        report('This browser cannot access the camera.');
        return;
      }

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          // The QR code is on a wall, so always prefer the rear camera.
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
      } catch (err) {
        const name = (err as DOMException)?.name;
        report(
          name === 'NotAllowedError'
            ? 'Camera permission was denied. Allow camera access to scan the branch QR code.'
            : name === 'NotFoundError'
              ? 'No camera was found on this device.'
              : 'Could not start the camera. Close any other app using it and try again.',
        );
        return;
      }

      if (cancelled) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }

      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) return;

      video.srcObject = stream;
      // Required for autoplay on iOS Safari.
      video.setAttribute('playsinline', 'true');
      try {
        await video.play();
      } catch {
        report('Could not start the camera preview.');
        return;
      }

      if (cancelled) return;
      setReady(true);

      let detector: Detector;
      try {
        detector = await createDetector();
      } catch {
        report('QR scanning is not supported in this browser.');
        return;
      }

      const tick = async () => {
        if (cancelled) return;
        if (!pausedRef.current && video.readyState >= 2) {
          try {
            const found = await detector.detect(video);
            const value = found[0]?.rawValue;
            if (value && !cancelled) onScanRef.current(value);
          } catch {
            // A single dropped frame is not worth surfacing; keep scanning.
          }
        }
        timer = setTimeout(tick, SCAN_INTERVAL_MS);
      };

      tick();
    }

    start();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      for (const track of streamRef.current?.getTracks() ?? []) track.stop();
      streamRef.current = null;
    };
  }, [report]);

  return (
    <div className="relative aspect-square w-full overflow-hidden border border-line bg-brand-secondary">
      <video
        ref={videoRef}
        muted
        playsInline
        className="h-full w-full object-cover"
      />

      {/* Framing guide */}
      {ready && !error && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-3/5 w-3/5 border-2 border-white/90" />
        </div>
      )}

      {!ready && !error && (
        <p className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-white">
          Starting camera…
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-white"
        >
          {error}
        </p>
      )}
    </div>
  );
}
