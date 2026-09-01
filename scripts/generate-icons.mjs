/**
 * Generates the PWA icon set from public/icon-512.png.
 *
 * Run with: npm run icons
 *
 * PWA manifests need several sizes, and Android's adaptive icons crop to a
 * circle — so the maskable variants are padded to keep the logo inside the
 * safe zone instead of having its corners shaved off.
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const SOURCE = path.join(process.cwd(), 'public', 'icon-512.png');
const OUT_DIR = path.join(process.cwd(), 'public', 'icons');

const SIZES = [64, 96, 128, 144, 152, 180, 192, 256, 384, 512];
const MASKABLE_SIZES = [192, 512];

/** Android safe zone: keep artwork within the middle ~80% of the canvas. */
const MASKABLE_INSET = 0.1;

const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };

/**
 * Brand teal, matching manifest.ts's theme_color. Maskable icons get this as
 * a full-bleed, solid background instead of white: Android's "Themed icons"
 * (dark-mode monochrome) feature can strip a white background and a black
 * mark down to a single dark tone, making the whole icon read as black-on-
 * black. A deterministic brand-color fill can't be swallowed that way, so the
 * mark is redrawn in white on top of it for contrast in both themes.
 */
const BRAND_TEAL = { r: 0x4a, g: 0x7c, b: 0x8c, alpha: 1 };

/** Recolors every non-transparent pixel of the source to white, alpha untouched. */
async function whiteSilhouette(sourcePath) {
  const { data, info } = await sharp(sourcePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] > 0) {
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
    }
  }

  return sharp(data, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png()
    .toBuffer();
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const meta = await sharp(SOURCE).metadata();
  console.log(`source: ${meta.width}x${meta.height} ${meta.format}`);

  for (const size of SIZES) {
    const out = path.join(OUT_DIR, `icon-${size}.png`);
    await sharp(SOURCE)
      .resize(size, size, { fit: 'contain', background: WHITE })
      .flatten({ background: WHITE })
      .png()
      .toFile(out);
    console.log(`  ${path.relative(process.cwd(), out)}`);
  }

  const whiteMark = await whiteSilhouette(SOURCE);

  for (const size of MASKABLE_SIZES) {
    const inner = Math.round(size * (1 - MASKABLE_INSET * 2));
    const pad = Math.round((size - inner) / 2);
    const out = path.join(OUT_DIR, `maskable-${size}.png`);
    await sharp(whiteMark)
      .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .flatten({ background: BRAND_TEAL })
      .extend({
        top: pad,
        bottom: size - inner - pad,
        left: pad,
        right: size - inner - pad,
        background: BRAND_TEAL,
      })
      .png()
      .toFile(out);
    console.log(`  ${path.relative(process.cwd(), out)}`);
  }

  // Favicon source consumed by src/app/icon.png.
  const favicon = path.join(process.cwd(), 'src', 'app', 'icon.png');
  await sharp(SOURCE)
    .resize(64, 64, { fit: 'contain', background: WHITE })
    .flatten({ background: WHITE })
    .png()
    .toFile(favicon);
  console.log(`  ${path.relative(process.cwd(), favicon)}`);

  const apple = path.join(process.cwd(), 'src', 'app', 'apple-icon.png');
  await sharp(SOURCE)
    .resize(180, 180, { fit: 'contain', background: WHITE })
    .flatten({ background: WHITE })
    .png()
    .toFile(apple);
  console.log(`  ${path.relative(process.cwd(), apple)}`);

  console.log('done');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
