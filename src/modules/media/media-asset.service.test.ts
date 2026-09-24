import { beforeEach, describe, expect, it } from 'vitest';

import {
  createCategory,
  createProduct,
  attachProductImage,
  detachProductImage,
} from '@/modules/catalog';
import { resetCatalogTables } from '@/modules/catalog/testing';

import {
  requestUpload,
  confirmUpload,
  updateAltText,
  getMediaAsset,
  isMediaAssetReferenced,
  deleteMediaAsset,
  findOrphanMediaAssets,
} from './media-asset.service';
import { handleLocalUploadPut } from './local-provider';
import { resetMediaTables } from './testing';
import { makeCorruptedImage, makeJpeg, makeNonImageFile, makePng } from './test-fixtures';
import type { SignedUpload } from './provider';

beforeEach(async () => {
  await resetCatalogTables();
  await resetMediaTables();
});

/** Drives the exact path a real client takes: request a signed upload, PUT
 * the bytes through the same authorization check the route handler uses,
 * then confirm. No shortcuts — this exercises the signature contract for
 * real, not a stand-in for it. */
async function uploadViaSignedUrl(
  buffer: Buffer,
  contentType: 'image/jpeg' | 'image/png' = 'image/jpeg',
) {
  const signed = await requestUpload({
    context: 'product',
    contentType,
    sizeBytes: buffer.byteLength,
  });
  await putViaSignedUrl(signed, buffer);
  return signed;
}

async function putViaSignedUrl(signed: SignedUpload, buffer: Buffer) {
  const url = new URL(signed.url, 'http://localhost');
  await handleLocalUploadPut({
    key: signed.key,
    contentType: url.searchParams.get('contentType')!,
    maxSizeBytes: Number(url.searchParams.get('maxSizeBytes')),
    expiresAtMs: Number(url.searchParams.get('expiresAtMs')),
    signature: url.searchParams.get('signature')!,
    body: buffer,
  });
}

describe('requestUpload', () => {
  it('returns a signed PUT upload under media/<context>/', async () => {
    const signed = await requestUpload({
      context: 'product',
      contentType: 'image/jpeg',
      sizeBytes: 1000,
    });
    expect(signed.method).toBe('PUT');
    expect(signed.key).toMatch(/^media\/product\/.+\.jpg$/);
    expect(signed.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('rejects an unrecognised context', async () => {
    const input = { context: 'not-a-real-context', contentType: 'image/jpeg', sizeBytes: 1000 };
    // @ts-expect-error — intentionally invalid to prove the schema rejects it
    await expect(requestUpload(input)).rejects.toThrow();
  });

  it('rejects a disallowed declared content type', async () => {
    await expect(
      // @ts-expect-error — intentionally invalid
      requestUpload({ context: 'product', contentType: 'application/pdf', sizeBytes: 1000 }),
    ).rejects.toThrow();
  });

  it('rejects an oversized declared size', async () => {
    await expect(
      requestUpload({ context: 'product', contentType: 'image/jpeg', sizeBytes: 999_999_999 }),
    ).rejects.toThrow();
  });

  it('two requests for the same context never collide on key', async () => {
    const a = await requestUpload({
      context: 'product',
      contentType: 'image/jpeg',
      sizeBytes: 1000,
    });
    const b = await requestUpload({
      context: 'product',
      contentType: 'image/jpeg',
      sizeBytes: 1000,
    });
    expect(a.key).not.toBe(b.key);
  });
});

describe('the signed upload URL itself (handleLocalUploadPut)', () => {
  it('accepts a body within the signed size', async () => {
    const signed = await requestUpload({
      context: 'product',
      contentType: 'image/jpeg',
      sizeBytes: 5_000_000,
    });
    await expect(putViaSignedUrl(signed, await makeJpeg())).resolves.toBeUndefined();
  });

  it('rejects an invalid/tampered signature', async () => {
    const signed = await requestUpload({
      context: 'product',
      contentType: 'image/jpeg',
      sizeBytes: 5_000_000,
    });
    const url = new URL(signed.url, 'http://localhost');
    await expect(
      handleLocalUploadPut({
        key: signed.key,
        contentType: url.searchParams.get('contentType')!,
        maxSizeBytes: Number(url.searchParams.get('maxSizeBytes')),
        expiresAtMs: Number(url.searchParams.get('expiresAtMs')),
        signature: 'forged-signature',
        body: await makeJpeg(),
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('rejects a request for a different key than the one signed (storage key manipulation)', async () => {
    const signed = await requestUpload({
      context: 'product',
      contentType: 'image/jpeg',
      sizeBytes: 5_000_000,
    });
    const url = new URL(signed.url, 'http://localhost');
    await expect(
      handleLocalUploadPut({
        key: 'media/product/some-other-key.jpg', // not what was signed
        contentType: url.searchParams.get('contentType')!,
        maxSizeBytes: Number(url.searchParams.get('maxSizeBytes')),
        expiresAtMs: Number(url.searchParams.get('expiresAtMs')),
        signature: url.searchParams.get('signature')!,
        body: await makeJpeg(),
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('rejects an expired signature', async () => {
    const signed = await requestUpload({
      context: 'product',
      contentType: 'image/jpeg',
      sizeBytes: 5_000_000,
    });
    const url = new URL(signed.url, 'http://localhost');
    await expect(
      handleLocalUploadPut({
        key: signed.key,
        contentType: url.searchParams.get('contentType')!,
        maxSizeBytes: Number(url.searchParams.get('maxSizeBytes')),
        expiresAtMs: Date.now() - 1000, // already expired
        signature: url.searchParams.get('signature')!,
        body: await makeJpeg(),
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('rejects a body larger than the signed max size', async () => {
    const signed = await requestUpload({
      context: 'product',
      contentType: 'image/jpeg',
      sizeBytes: 100,
    });
    const url = new URL(signed.url, 'http://localhost');
    const oversized = Buffer.alloc(200, 1);
    await expect(
      handleLocalUploadPut({
        key: signed.key,
        contentType: url.searchParams.get('contentType')!,
        maxSizeBytes: Number(url.searchParams.get('maxSizeBytes')),
        expiresAtMs: Number(url.searchParams.get('expiresAtMs')),
        signature: url.searchParams.get('signature')!,
        body: oversized,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

describe('confirmUpload', () => {
  it('creates a MediaAsset from real, verified image bytes — not the declared content-type', async () => {
    const jpeg = await makeJpeg(12, 9);
    const signed = await uploadViaSignedUrl(jpeg);

    const asset = await confirmUpload({ key: signed.key }, { altAr: 'صورة', altEn: 'photo' });

    expect(asset.provider).toBe('LOCAL');
    expect(asset.mime).toBe('image/jpeg');
    expect(asset.width).toBe(12);
    expect(asset.height).toBe(9);
    expect(asset.sizeBytes).toBe(jpeg.byteLength);
    expect(asset.contentHash).toHaveLength(64); // sha256 hex
    expect(asset.altAr).toBe('صورة');
    expect(asset.altEn).toBe('photo');
  });

  it('rejects confirming a key nothing was uploaded to', async () => {
    await expect(confirmUpload({ key: 'media/product/never-uploaded.jpg' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('rejects (and deletes) a file that is not a real image, regardless of its declared content-type', async () => {
    const signed = await uploadViaSignedUrl(makeNonImageFile());
    await expect(confirmUpload({ key: signed.key })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });

    // The bogus object doesn't linger in storage after rejection.
    const second = await requestUpload({
      context: 'product',
      contentType: 'image/jpeg',
      sizeBytes: 10,
    });
    expect(second.key).not.toBe(signed.key); // sanity: different upload
  });

  it('rejects a corrupted image', async () => {
    const signed = await uploadViaSignedUrl(await makeCorruptedImage());
    await expect(confirmUpload({ key: signed.key })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('deduplicates by content hash: the same bytes twice return the same MediaAsset', async () => {
    const jpeg = await makeJpeg(8, 8);
    const first = await uploadViaSignedUrl(jpeg);
    const firstAsset = await confirmUpload({ key: first.key });

    const second = await uploadViaSignedUrl(jpeg); // identical bytes, different key
    const secondAsset = await confirmUpload({ key: second.key });

    expect(secondAsset.id).toBe(firstAsset.id);

    const all = await findOrphanMediaAssets();
    expect(all).toHaveLength(1); // no duplicate row was created
  });

  it('different images produce different MediaAssets', async () => {
    const a = await confirmUpload({ key: (await uploadViaSignedUrl(await makeJpeg(4, 4))).key });
    const b = await confirmUpload({
      key: (await uploadViaSignedUrl(await makePng(4, 4), 'image/png')).key,
    });
    expect(a.id).not.toBe(b.id);
  });
});

describe('updateAltText', () => {
  it('updates alt text on an existing asset', async () => {
    const signed = await uploadViaSignedUrl(await makeJpeg());
    const asset = await confirmUpload({ key: signed.key });
    const updated = await updateAltText(asset.id, { altAr: 'محدث', altEn: 'updated' });
    expect(updated.altAr).toBe('محدث');
  });

  it('rejects an id that does not exist', async () => {
    await expect(
      updateAltText('00000000-0000-0000-0000-000000000000', { altEn: 'x' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('reference tracking and deletion safety', () => {
  async function productFixture() {
    const category = await createCategory({ slug: 'shoes', nameAr: 'أحذية', nameEn: 'Shoes' });
    return createProduct({
      product: { slug: 'shoe', nameAr: 'حذاء', nameEn: 'Shoe', categoryId: category.id },
      variants: [{ sku: 'SHOE-1', priceMinor: 10000 }],
    });
  }

  it('an unreferenced asset can be deleted', async () => {
    const signed = await uploadViaSignedUrl(await makeJpeg());
    const asset = await confirmUpload({ key: signed.key });

    expect(await isMediaAssetReferenced(asset.id)).toBe(false);
    await deleteMediaAsset(asset.id);
    expect(await getMediaAsset(asset.id)).toBeNull();
  });

  it('a referenced asset cannot be deleted', async () => {
    const product = await productFixture();
    const signed = await uploadViaSignedUrl(await makeJpeg());
    const asset = await confirmUpload({ key: signed.key });
    await attachProductImage(product.id, asset.id);

    expect(await isMediaAssetReferenced(asset.id)).toBe(true);
    await expect(deleteMediaAsset(asset.id)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await getMediaAsset(asset.id)).not.toBeNull(); // still there
  });

  it('detaching removes the reference, after which the asset is deletable', async () => {
    const product = await productFixture();
    const signed = await uploadViaSignedUrl(await makeJpeg());
    const asset = await confirmUpload({ key: signed.key });
    const image = await attachProductImage(product.id, asset.id);

    await detachProductImage(image.id);
    expect(await isMediaAssetReferenced(asset.id)).toBe(false);
    await expect(deleteMediaAsset(asset.id)).resolves.toBeUndefined();
  });

  it('a shared asset (two products) survives detaching it from only one', async () => {
    const productA = await productFixture();
    const category = await createCategory({
      slug: 'more-shoes',
      nameAr: 'أحذية 2',
      nameEn: 'More shoes',
    });
    const productB = await createProduct({
      product: { slug: 'shoe-2', nameAr: 'حذاء 2', nameEn: 'Shoe 2', categoryId: category.id },
      variants: [{ sku: 'SHOE-2', priceMinor: 10000 }],
    });

    const signed = await uploadViaSignedUrl(await makeJpeg());
    const asset = await confirmUpload({ key: signed.key });
    const imageA = await attachProductImage(productA.id, asset.id);
    await attachProductImage(productB.id, asset.id);

    await detachProductImage(imageA.id);
    expect(await isMediaAssetReferenced(asset.id)).toBe(true); // still used by productB
    await expect(deleteMediaAsset(asset.id)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('rejects deleting an id that does not exist', async () => {
    await expect(deleteMediaAsset('00000000-0000-0000-0000-000000000000')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('findOrphanMediaAssets', () => {
  it('lists only assets with no reference anywhere', async () => {
    const product = await productFixture_();
    const referencedSigned = await uploadViaSignedUrl(await makeJpeg());
    const referenced = await confirmUpload({ key: referencedSigned.key });
    await attachProductImage(product.id, referenced.id);

    const orphanSigned = await uploadViaSignedUrl(await makePng(), 'image/png');
    const orphan = await confirmUpload({ key: orphanSigned.key });

    const orphans = await findOrphanMediaAssets();
    expect(orphans.map((a) => a.id)).toEqual([orphan.id]);
    expect(orphans.map((a) => a.id)).not.toContain(referenced.id);
  });

  async function productFixture_() {
    const category = await createCategory({ slug: 'toys', nameAr: 'ألعاب', nameEn: 'Toys' });
    return createProduct({
      product: { slug: 'toy', nameAr: 'لعبة', nameEn: 'Toy', categoryId: category.id },
      variants: [{ sku: 'TOY-1', priceMinor: 5000 }],
    });
  }
});
