/**
 * Full-sensor captures from 50 MP phones exceed the 5 MiB sharing limit. About 8 MP keeps
 * small pouch text legible for OCR while a quality-0.85 JPEG stays near 2–4 MB.
 */
export const MAX_CAPTURE_PIXELS = 8_500_000;
const MIN_SHORT_SIDE = 1080;

/** Choose the largest "WIDTHxHEIGHT" size within the cap. Unparseable presets keep the camera default. */
export function choosePictureSize(sizes: readonly string[]): string | undefined {
  let best: { size: string; pixels: number } | undefined;
  for (const size of sizes) {
    const match = /^(\d{3,5})x(\d{3,5})$/.exec(size);
    if (!match) continue;
    const width = Number(match[1]);
    const height = Number(match[2]);
    const pixels = width * height;
    if (Math.min(width, height) < MIN_SHORT_SIDE || pixels > MAX_CAPTURE_PIXELS) continue;
    if (!best || pixels > best.pixels) best = { size, pixels };
  }
  return best?.size;
}
