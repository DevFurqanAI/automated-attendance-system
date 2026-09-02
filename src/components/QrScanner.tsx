'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Camera QR scanner.
 *
 * - Uses native BarcodeDetector when available.
 * - Falls back to barcode-detector/ponyfill on unsupported browsers.
 * - Captures video frames into a canvas before scanning.
 *   This is more reliable on iOS Safari.
 */

type Detector = {
  detect: (
    source: CanvasImageSource,
  ) => Promise<{ rawValue: string }[]>;
};

const SCAN_INTERVAL_MS = 250;
const MAX_SCAN_WIDTH = 1280;

async function createDetector(): Promise<Detector> {
  const NativeBarcodeDetector = (
    globalThis as unknown as {
      BarcodeDetector?: new (options: {
        formats: string[];
      }) => Detector;
    }
  ).BarcodeDetector;

  // Try native BarcodeDetector first.
  if (NativeBarcodeDetector) {
    try {
      return new NativeBarcodeDetector({
        formats: ['qr_code'],
      });
    } catch (error) {
      console.warn(
        'Native BarcodeDetector failed. Falling back to ponyfill.',
        error,
      );
    }
  }

  // Fallback for Safari/iPhone and other unsupported browsers.
  const { BarcodeDetector } = await import(
    'barcode-detector/ponyfill'
  );

  return new BarcodeDetector({
    formats: ['qr_code'],
  }) as unknown as Detector;
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
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const onScanRef = useRef(onScan);
  const pausedRef = useRef(paused);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Keep callback references fresh without restarting the camera.
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
      onError?.(message);
    },
    [onError],
  );

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let scanning = false;

    /**
     * Stop the current camera stream.
     */
    const stopCamera = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }

      const stream = streamRef.current;

      if (stream) {
        for (const track of stream.getTracks()) {
          track.stop();
        }
      }

      streamRef.current = null;
    };

    /**
     * Start camera and scanner.
     */
    async function startScanner() {
      setError(null);
      setReady(false);

      /**
       * Camera APIs require HTTPS on real devices.
       */
      if (!navigator.mediaDevices?.getUserMedia) {
        reportError(
          'This browser cannot access the camera. Make sure the website is opened using HTTPS.',
        );
        return;
      }

      let stream: MediaStream;

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            /**
             * Prefer the rear camera.
             */
            facingMode: {
              ideal: 'environment',
            },

            /**
             * Request enough resolution for detailed QR codes.
             */
            width: {
              ideal: 1920,
            },

            height: {
              ideal: 1080,
            },
          },

          audio: false,
        });
      } catch (err) {
        console.error('getUserMedia failed:', err);

        const name = (err as DOMException)?.name;

        if (name === 'NotAllowedError') {
          reportError(
            'Camera permission was denied. Allow camera access in your browser settings and try again.',
          );
          return;
        }

        if (name === 'NotFoundError') {
          reportError(
            'No camera was found on this device.',
          );
          return;
        }

        if (name === 'NotReadableError') {
          reportError(
            'The camera is currently unavailable. Close other apps using the camera and try again.',
          );
          return;
        }

        if (name === 'OverconstrainedError') {
          reportError(
            'The requested camera settings are not supported on this device.',
          );
          return;
        }

        reportError(
          'Could not start the camera. Please check your camera permissions and try again.',
        );

        return;
      }

      /**
       * Component may have unmounted while permission dialog was open.
       */
      if (cancelled) {
        for (const track of stream.getTracks()) {
          track.stop();
        }

        return;
      }

      streamRef.current = stream;

      const video = videoRef.current;

      if (!video) {
        stopCamera();
        return;
      }

      /**
       * Important for iOS Safari.
       */
      video.muted = true;
      video.autoplay = true;
      video.playsInline = true;

      video.setAttribute('playsinline', 'true');
      video.setAttribute('webkit-playsinline', 'true');

      video.srcObject = stream;

      /**
       * Wait for video metadata before scanning.
       */
      try {
        if (
          video.readyState <
            HTMLMediaElement.HAVE_METADATA ||
          video.videoWidth === 0 ||
          video.videoHeight === 0
        ) {
          await new Promise<void>(
            (resolve, reject) => {
              const handleLoadedMetadata = () => {
                cleanup();
                resolve();
              };

              const handleError = () => {
                cleanup();
                reject(
                  new Error(
                    'Video metadata could not be loaded.',
                  ),
                );
              };

              const cleanup = () => {
                video.removeEventListener(
                  'loadedmetadata',
                  handleLoadedMetadata,
                );

                video.removeEventListener(
                  'error',
                  handleError,
                );
              };

              video.addEventListener(
                'loadedmetadata',
                handleLoadedMetadata,
                {
                  once: true,
                },
              );

              video.addEventListener(
                'error',
                handleError,
                {
                  once: true,
                },
              );
            },
          );
        }

        await video.play();
      } catch (err) {
        console.error(
          'Could not start video preview:',
          err,
        );

        stopCamera();

        reportError(
          'Could not start the camera preview. On iPhone, make sure camera permission is enabled for this website.',
        );

        return;
      }

      if (cancelled) {
        stopCamera();
        return;
      }

      console.log('Camera started:', {
        width: video.videoWidth,
        height: video.videoHeight,
        readyState: video.readyState,
      });

      /**
       * Create barcode detector.
       */
      let detector: Detector;

      try {
        detector = await createDetector();
      } catch (err) {
        console.error(
          'Could not create QR detector:',
          err,
        );

        stopCamera();

        reportError(
          'QR scanning is not supported in this browser.',
        );

        return;
      }

      if (cancelled) {
        stopCamera();
        return;
      }

      setReady(true);

      /**
       * Scan one frame.
       */
      const scanFrame = async () => {
        if (cancelled) {
          return;
        }

        /**
         * Prevent overlapping detector calls.
         *
         * Some iPhones can take longer than 250ms to decode a
         * frame, so we don't want multiple scans running at once.
         */
        if (scanning) {
          timer = setTimeout(
            scanFrame,
            SCAN_INTERVAL_MS,
          );
          return;
        }

        if (pausedRef.current) {
          timer = setTimeout(
            scanFrame,
            SCAN_INTERVAL_MS,
          );
          return;
        }

        if (
          video.readyState <
            HTMLMediaElement.HAVE_CURRENT_DATA ||
          video.videoWidth <= 0 ||
          video.videoHeight <= 0
        ) {
          timer = setTimeout(
            scanFrame,
            SCAN_INTERVAL_MS,
          );
          return;
        }

        const canvas = canvasRef.current;

        if (!canvas) {
          timer = setTimeout(
            scanFrame,
            SCAN_INTERVAL_MS,
          );
          return;
        }

        scanning = true;

        try {
          /**
           * Scale the camera frame down if necessary.
           *
           * Scanning a full-resolution iPhone camera frame can be
           * unnecessarily expensive.
           */
          const scale = Math.min(
            1,
            MAX_SCAN_WIDTH / video.videoWidth,
          );

          const scanWidth = Math.max(
            1,
            Math.round(video.videoWidth * scale),
          );

          const scanHeight = Math.max(
            1,
            Math.round(video.videoHeight * scale),
          );

          if (
            canvas.width !== scanWidth ||
            canvas.height !== scanHeight
          ) {
            canvas.width = scanWidth;
            canvas.height = scanHeight;
          }

          const context = canvas.getContext('2d', {
            willReadFrequently: true,
          });

          if (!context) {
            throw new Error(
              'Could not create canvas context.',
            );
          }

          /**
           * Copy the current camera frame into the canvas.
           */
          context.drawImage(
            video,
            0,
            0,
            scanWidth,
            scanHeight,
          );

          /**
           * Detect QR code from the canvas instead of directly
           * from the <video> element.
           */
          const results =
            await detector.detect(canvas);

          if (cancelled) {
            return;
          }

          const value = results[0]?.rawValue;

          if (value) {
            console.log(
              'QR code detected:',
              value,
            );

            onScanRef.current(value);
          }
        } catch (err) {
          /**
           * IMPORTANT:
           *
           * Do not silently ignore these while debugging iPhones.
           * Safari errors will appear here.
           */
          console.error(
            'QR detection failed:',
            err,
          );
        } finally {
          scanning = false;
        }

        if (!cancelled) {
          timer = setTimeout(
            scanFrame,
            SCAN_INTERVAL_MS,
          );
        }
      };

      scanFrame();
    }

    startScanner();

    return () => {
      cancelled = true;
      stopCamera();
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

      {/*
       * Hidden canvas used for QR decoding.
       *
       * Do NOT use display:none here.
       * Keeping it visually hidden/off-screen avoids some browser
       * inconsistencies with drawing/detection.
       */}
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="pointer-events-none absolute left-[-9999px] top-[-9999px]"
      />

      {/* QR framing guide */}
      {ready && !error && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="relative h-3/5 w-3/5">
            <div className="absolute left-0 top-0 h-8 w-8 border-l-4 border-t-4 border-white" />

            <div className="absolute right-0 top-0 h-8 w-8 border-r-4 border-t-4 border-white" />

            <div className="absolute bottom-0 left-0 h-8 w-8 border-b-4 border-l-4 border-white" />

            <div className="absolute bottom-0 right-0 h-8 w-8 border-b-4 border-r-4 border-white" />
          </div>
        </div>
      )}

      {/* Loading */}
      {!ready && !error && (
        <p className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-white">
          Starting camera…
        </p>
      )}

      {/* Error */}
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