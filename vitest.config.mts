import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(root, 'src'),
      /*
       * `server-only` is a marker package whose default entry throws on import.
       * Next resolves it through the `react-server` condition to an empty
       * module; outside Next we point it at that same empty module directly so
       * genuinely server-side units (qr-token) can be unit-tested.
       */
      'server-only': path.resolve(root, 'node_modules/server-only/empty.js'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
