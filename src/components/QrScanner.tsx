'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BrowserQRCodeReader,
  IScannerControls,
} from '@zxing/browser';

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

  const controlsRef = useRef<IScannerControls | null>(null);
  const readerRef = useRef<BrowserQRCodeReader | null>(null);

  const onScanRef = useRef(onScan);
  const pausedRef = useRef(paused);

  const lastScannedValueRef = useRef<string | null>(null);
  const lastScannedTimeRef = useRef<number>(0);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Keep callback references updated without restarting
   * the camera every time the parent component renders.
   */
  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  const reportError = useCallback(
    (message: string) => {
      setError(message);

      if (onError) {
        onError(message);
      }
    },
    [onError],
  );

  useEffect(() => {
    let cancelled = false;

    async function startScanner() {
      setError(null);
      setReady(false);

      /**
       * Camera APIs require a secure context on mobile.
       */
      if (
        !navigator.mediaDevices ||
        !navigator.mediaDevices.getUserMedia
      ) {
        reportError(
          'This browser cannot access the camera. Please use a supported browser and make sure the website is opened using HTTPS.',
        );

        return;
      }

      const video = videoRef.current;

      if (!video) {
        reportError(
          'Could not initialize the camera preview.',
        );

        return;
      }

      /**
       * Important for iPhone/iPad Safari and Chrome.
       */
      video.setAttribute('playsinline', 'true');
      video.setAttribute('webkit-playsinline', 'true');

      video.playsInline = true;
      video.muted = true;
      video.autoplay = true;

      try {
        /**
         * BrowserQRCodeReader is dedicated specifically
         * to QR codes.
         */
        const reader = new BrowserQRCodeReader(undefined, {
          delayBetweenScanAttempts: 150,
          delayBetweenScanSuccess: 500,
        });

        readerRef.current = reader;

        /**
         * Prefer the rear/environment camera.
         *
         * Don't force exact device IDs because Safari handles
         * camera identifiers differently from Android Chrome.
         */
        const constraints: MediaStreamConstraints = {
          video: {
            facingMode: {
              ideal: 'environment',
            },

            width: {
              ideal: 1920,
            },

            height: {
              ideal: 1080,
            },
          },

          audio: false,
        };

        const controls =
          await reader.decodeFromConstraints(
            constraints,
            video,
            (result) => {
              if (cancelled) {
                return;
              }

              /**
               * "No QR found in this particular frame" is normal,
               * so we don't show that as an error.
               */
              if (!result) {
                return;
              }

              if (pausedRef.current) {
                return;
              }

              const value = result.getText();

              if (!value) {
                return;
              }

              /**
               * Prevent continuously sending the same QR to the
               * backend dozens of times while the camera remains
               * pointed at it.
               */
              const now = Date.now();

              const sameValue =
                lastScannedValueRef.current === value;

              const recentlyScanned =
                now - lastScannedTimeRef.current < 1500;

              if (sameValue && recentlyScanned) {
                return;
              }

              lastScannedValueRef.current = value;
              lastScannedTimeRef.current = now;

              console.log(
                'QR code detected:',
                value,
              );

              onScanRef.current(value);
            },
          );

        if (cancelled) {
          controls.stop();
          return;
        }

        controlsRef.current = controls;

        /**
         * Wait until Safari actually has camera frames.
         */
        const waitForVideo = () =>
          new Promise<void>((resolve) => {
            if (
              video.readyState >=
                HTMLMediaElement.HAVE_CURRENT_DATA &&
              video.videoWidth > 0 &&
              video.videoHeight > 0
            ) {
              resolve();
              return;
            }

            const handler = () => {
              if (
                video.videoWidth > 0 &&
                video.videoHeight > 0
              ) {
                video.removeEventListener(
                  'loadeddata',
                  handler,
                );

                video.removeEventListener(
                  'playing',
                  handler,
                );

                resolve();
              }
            };

            video.addEventListener(
              'loadeddata',
              handler,
            );

            video.addEventListener(
              'playing',
              handler,
            );

            /**
             * Don't keep the UI stuck on "Starting camera"
             * indefinitely if Safari doesn't fire the event
             * exactly as expected.
             */
            setTimeout(() => {
              resolve();
            }, 1500);
          });

        await waitForVideo();

        if (cancelled) {
          controls.stop();
          return;
        }

        console.log('Camera started:', {
          width: video.videoWidth,
          height: video.videoHeight,
          readyState: video.readyState,
        });

        setReady(true);
      } catch (err) {
        console.error(
          'QR scanner initialization failed:',
          err,
        );

        if (cancelled) {
          return;
        }

        const domError = err as DOMException;

        if (
          domError?.name === 'NotAllowedError' ||
          domError?.name === 'PermissionDeniedError'
        ) {
          reportError(
            'Camera permission was denied. Please allow camera access for this website in your browser settings and try again.',
          );

          return;
        }

        if (domError?.name === 'NotFoundError') {
          reportError(
            'No camera was found on this device.',
          );

          return;
        }

        if (
          domError?.name === 'NotReadableError'
        ) {
          reportError(
            'The camera is currently unavailable. Close any other app using the camera and try again.',
          );

          return;
        }

        if (
          domError?.name === 'OverconstrainedError'
        ) {
          reportError(
            'The requested camera settings are not supported on this device.',
          );

          return;
        }

        reportError(
          'Could not start the QR scanner. Please refresh the page and try again.',
        );
      }
    }

    startScanner();

    const videoElement = videoRef.current;

    return () => {
      cancelled = true;

      try {
        controlsRef.current?.stop();
      } catch (err) {
        console.warn(
          'Could not stop QR scanner:',
          err,
        );
      }

      controlsRef.current = null;
      readerRef.current = null;

      /**
       * Extra cleanup for Safari.
       * Use the video element captured when this effect ran.
       */
      if (videoElement?.srcObject) {
        const stream =
          videoElement.srcObject as MediaStream;

        for (const track of stream.getTracks()) {
          track.stop();
        }

        videoElement.srcObject = null;
      }
    };
  }, [reportError]);

  return (
    <div className="relative aspect-square w-full overflow-hidden border border-line bg-brand-secondary">
      {/* Camera preview */}
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        disablePictureInPicture
        className="h-full w-full object-cover"
      />

      {/* QR framing guide */}
      {ready && !error && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="relative h-3/5 w-3/5">
            {/* Top left */}
            <div className="absolute left-0 top-0 h-9 w-9 border-l-4 border-t-4 border-white" />

            {/* Top right */}
            <div className="absolute right-0 top-0 h-9 w-9 border-r-4 border-t-4 border-white" />

            {/* Bottom left */}
            <div className="absolute bottom-0 left-0 h-9 w-9 border-b-4 border-l-4 border-white" />

            {/* Bottom right */}
            <div className="absolute bottom-0 right-0 h-9 w-9 border-b-4 border-r-4 border-white" />
          </div>
        </div>
      )}

      {/* Loading state */}
      {!ready && !error && (
        <p className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-white">
          Starting camera…
        </p>
      )}

      {/* Error state */}
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