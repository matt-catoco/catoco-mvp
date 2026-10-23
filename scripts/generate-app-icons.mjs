// Generates the app/PWA icon set from the brand mark (public/brand/catoco-mark.svg
// geometry). Run with `node scripts/generate-app-icons.mjs` after changing the
// mark. Outputs:
//   app/icon.png                 512, rounded tile, transparent corners (favicon / tab icon)
//   app/apple-icon.png           180, full-bleed square (iOS rounds the corners itself)
//   public/icon-192.png          192, rounded tile, transparent corners (manifest "any")
//   public/icon-512.png          512, rounded tile, transparent corners (manifest "any")
//   public/icon-maskable-512.png 512, full-bleed teal, mark inside the 80% safe zone (manifest "maskable")
import sharp from "sharp";

const TEAL = "#2DD4BF";
const INK = "#0D2020";

// The mark's inner art (dashed square + diamond) on a 512 canvas.
const art = `
  <rect x="77" y="77" width="358" height="358" rx="61" fill="none" stroke="${INK}" stroke-width="15" stroke-dasharray="15,20"/>
  <rect x="184" y="184" width="144" height="144" rx="31" fill="${INK}" transform="rotate(45 256 256)"/>`;

const rounded = `<svg viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <rect width="512" height="512" rx="113" fill="${TEAL}"/>${art}</svg>`;

const fullBleed = `<svg viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <rect width="512" height="512" fill="${TEAL}"/>${art}</svg>`;

// Maskable: launchers crop to shapes as small as a circle with 80% of the
// width. The dashed square's corners reach ~253px from the centre, so scale
// the art to 0.8 (corners at ~202px, inside the 204.8px safe radius).
const maskable = `<svg viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <rect width="512" height="512" fill="${TEAL}"/>
  <g transform="translate(256 256) scale(0.8) translate(-256 -256)">${art}</g></svg>`;

const out = async (svg, size, file) => {
  await sharp(Buffer.from(svg), { density: 384 }).resize(size, size).png({ compressionLevel: 9 }).toFile(file);
  console.log("wrote", file, `${size}x${size}`);
};

await out(rounded, 512, "app/icon.png");
await out(fullBleed, 180, "app/apple-icon.png");
await out(rounded, 192, "public/icon-192.png");
await out(rounded, 512, "public/icon-512.png");
await out(maskable, 512, "public/icon-maskable-512.png");
