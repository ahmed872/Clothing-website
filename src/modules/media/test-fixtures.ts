import sharp from 'sharp';

/**
 * Test-only: real, valid image bytes generated on the fly rather than
 * checked-in binary fixture files — a 4x4 red square is exactly as good a
 * "valid JPEG" as a photo for exercising `sniffImage`, and generating it
 * means there's no binary file in the repo whose provenance has to be
 * trusted.
 */

export async function makeJpeg(width = 4, height = 4): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 200, g: 30, b: 30 } } })
    .jpeg()
    .toBuffer();
}

export async function makePng(width = 4, height = 4): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 4, background: { r: 30, g: 30, b: 200, alpha: 1 } },
  })
    .png()
    .toBuffer();
}

export async function makeWebp(width = 4, height = 4): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 30, g: 200, b: 30 } } })
    .webp()
    .toBuffer();
}

/** Well-formed enough to have a plausible-looking start, but truncated
 * mid-stream — the "corrupted image" case, distinct from "not an image at
 * all". */
export async function makeCorruptedImage(): Promise<Buffer> {
  const real = await makeJpeg(64, 64);
  return real.subarray(0, Math.floor(real.length / 3));
}

/** Not an image in any format — the "fake extension" / "wrong content"
 * case: a caller could name this `photo.jpg` and declare `image/jpeg`, and
 * `sniffImage` still reports it as undecodable. */
export function makeNonImageFile(): Buffer {
  return Buffer.from('this is a plain text file pretending to be an image', 'utf-8');
}
