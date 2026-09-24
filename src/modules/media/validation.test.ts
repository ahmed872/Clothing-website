import { describe, expect, it } from 'vitest';

import { sniffImage, validateDeclaredUpload } from './validation';
import { MAX_UPLOAD_BYTES } from './provider';
import { makeCorruptedImage, makeJpeg, makeNonImageFile, makePng, makeWebp } from './test-fixtures';

describe('sniffImage', () => {
  it('detects a valid JPEG regardless of what it might be named', async () => {
    const result = await sniffImage(await makeJpeg(10, 8));
    expect(result).toMatchObject({ format: 'jpeg', mime: 'image/jpeg', width: 10, height: 8 });
  });

  it('detects a valid PNG', async () => {
    const result = await sniffImage(await makePng(6, 6));
    expect(result).toMatchObject({ format: 'png', mime: 'image/png' });
  });

  it('detects a valid WebP', async () => {
    const result = await sniffImage(await makeWebp(6, 6));
    expect(result).toMatchObject({ format: 'webp', mime: 'image/webp' });
  });

  it('rejects a corrupted image', async () => {
    expect(await sniffImage(await makeCorruptedImage())).toBeNull();
  });

  it('rejects a file that is not an image at all, no matter its claimed type', async () => {
    expect(await sniffImage(makeNonImageFile())).toBeNull();
  });

  it('rejects an empty buffer', async () => {
    expect(await sniffImage(Buffer.alloc(0))).toBeNull();
  });
});

describe('validateDeclaredUpload', () => {
  it('accepts an allowed content type within the size limit', () => {
    expect(validateDeclaredUpload({ contentType: 'image/jpeg', sizeBytes: 1000 })).toBeNull();
  });

  it('rejects a disallowed content type', () => {
    expect(validateDeclaredUpload({ contentType: 'application/pdf', sizeBytes: 1000 })).toMatch(
      /Unsupported/,
    );
  });

  it('rejects an SVG (deliberately not in the allowed set — script content risk)', () => {
    expect(validateDeclaredUpload({ contentType: 'image/svg+xml', sizeBytes: 1000 })).toMatch(
      /Unsupported/,
    );
  });

  it('rejects an oversized declaration', () => {
    expect(
      validateDeclaredUpload({ contentType: 'image/png', sizeBytes: MAX_UPLOAD_BYTES + 1 }),
    ).toMatch(/exceeds/);
  });

  it('rejects a non-positive size', () => {
    expect(validateDeclaredUpload({ contentType: 'image/png', sizeBytes: 0 })).toMatch(/positive/);
    expect(validateDeclaredUpload({ contentType: 'image/png', sizeBytes: -5 })).toMatch(/positive/);
  });
});
