import sharp from 'sharp';

import { ALLOWED_IMAGE_MIME_TYPES, MAX_UPLOAD_BYTES, type AllowedImageMimeType } from './provider';

/**
 * The one place file content is actually trusted from — everything else
 * (client-declared content-type, filename/extension, declared size) is a
 * hint used only to shape the request, never the basis for what gets stored.
 */

export interface SniffedImage {
  format: 'jpeg' | 'png' | 'webp';
  mime: AllowedImageMimeType;
  width: number;
  height: number;
}

const FORMAT_TO_MIME: Record<SniffedImage['format'], AllowedImageMimeType> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

/**
 * Decodes the actual bytes and returns the real format/dimensions, or `null`
 * if they don't decode as one of `ALLOWED_IMAGE_MIME_TYPES` at all — a
 * corrupted file, a renamed non-image, or a format we don't accept. Sharp
 * reads the format from the file's own signature/structure, not from a
 * filename or a header a client sent, which is exactly the property this
 * needs: a `.jpg` that is actually a PNG is reported as PNG, and a `.jpg`
 * that isn't an image at all is reported as not decodable.
 */
export async function sniffImage(buffer: Buffer): Promise<SniffedImage | null> {
  try {
    const metadata = await sharp(buffer, { failOn: 'error' }).metadata();
    if (!metadata.format || !metadata.width || !metadata.height) return null;
    if (!(metadata.format in FORMAT_TO_MIME)) return null;

    const format = metadata.format as SniffedImage['format'];
    return { format, mime: FORMAT_TO_MIME[format], width: metadata.width, height: metadata.height };
  } catch {
    return null;
  }
}

export interface DeclaredUploadInput {
  contentType: string;
  sizeBytes: number;
}

/** First-pass validation of what the client *declares* it wants to upload —
 * cheap, and rejects the obviously-wrong request before a signed URL is ever
 * issued. Not the security boundary: `sniffImage` on the real bytes at
 * confirm time is. */
export function validateDeclaredUpload(input: DeclaredUploadInput): string | null {
  if (!ALLOWED_IMAGE_MIME_TYPES.includes(input.contentType as AllowedImageMimeType)) {
    return `Unsupported content type: ${input.contentType}. Allowed: ${ALLOWED_IMAGE_MIME_TYPES.join(', ')}`;
  }
  if (!Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0) {
    return 'sizeBytes must be a positive integer';
  }
  if (input.sizeBytes > MAX_UPLOAD_BYTES) {
    return `File exceeds the ${MAX_UPLOAD_BYTES} byte limit`;
  }
  return null;
}
