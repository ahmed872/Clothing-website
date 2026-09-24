import { beforeEach, describe, expect, it } from 'vitest';

import { createCategory } from './category.service';
import { createProduct } from './product.service';
import {
  attachProductImage,
  detachProductImage,
  setPrimaryProductImage,
  reorderProductImages,
  listProductImages,
} from './product-image.service';
import { resetCatalogTables } from './testing';

import {
  requestUpload,
  confirmUpload,
  handleLocalUploadPut,
  type SignedUpload,
} from '@/modules/media';
import { resetMediaTables } from '@/modules/media/testing';
import { makeJpeg } from '@/modules/media/test-fixtures';

beforeEach(async () => {
  await resetCatalogTables();
  await resetMediaTables();
});

// Each call must produce visually-distinct (so byte-distinct) bytes: media
// dedups by content hash (P04), and this suite specifically tests multiple
// *different* images attached to one product — identical bytes would just
// resolve to the same MediaAsset every time, which is its own (well-tested,
// elsewhere) behaviour, not what these tests are exercising.
let uploadCounter = 0;

async function uploadImage() {
  uploadCounter += 1;
  const signed: SignedUpload = await requestUpload({
    context: 'product',
    contentType: 'image/jpeg',
    sizeBytes: 5000,
  });
  const url = new URL(signed.url, 'http://localhost');
  await handleLocalUploadPut({
    key: signed.key,
    contentType: url.searchParams.get('contentType')!,
    maxSizeBytes: Number(url.searchParams.get('maxSizeBytes')),
    expiresAtMs: Number(url.searchParams.get('expiresAtMs')),
    signature: url.searchParams.get('signature')!,
    body: await makeJpeg(4 + uploadCounter, 4), // distinct dimensions -> distinct bytes
  });
  return confirmUpload({ key: signed.key });
}

async function productFixture() {
  const category = await createCategory({ slug: 'watches', nameAr: 'ساعات', nameEn: 'Watches' });
  return createProduct({
    product: { slug: 'watch', nameAr: 'ساعة', nameEn: 'Watch', categoryId: category.id },
    variants: [{ sku: 'WATCH-1', priceMinor: 20000 }],
  });
}

describe('attachProductImage', () => {
  it('attaches an image and makes the first one primary by default', async () => {
    const product = await productFixture();
    const media = await uploadImage();
    const image = await attachProductImage(product.id, media.id);
    expect(image.isPrimary).toBe(true);
    expect(image.position).toBe(0);
  });

  it('does not make a second image primary by default', async () => {
    const product = await productFixture();
    const first = await attachProductImage(product.id, (await uploadImage()).id);
    const second = await attachProductImage(product.id, (await uploadImage()).id);
    expect(first.isPrimary).toBe(true);
    expect(second.isPrimary).toBe(false);
    expect(second.position).toBe(1);
  });

  it('explicitly setting isPrimary demotes the previous primary', async () => {
    const product = await productFixture();
    const first = await attachProductImage(product.id, (await uploadImage()).id);
    const second = await attachProductImage(product.id, (await uploadImage()).id, {
      isPrimary: true,
    });

    const images = await listProductImages(product.id);
    expect(images.find((i) => i.id === first.id)?.isPrimary).toBe(false);
    expect(images.find((i) => i.id === second.id)?.isPrimary).toBe(true);
  });

  it('supports multiple images on one product', async () => {
    const product = await productFixture();
    await attachProductImage(product.id, (await uploadImage()).id);
    await attachProductImage(product.id, (await uploadImage()).id);
    await attachProductImage(product.id, (await uploadImage()).id);
    expect(await listProductImages(product.id)).toHaveLength(3);
  });

  it('the same media asset can be attached to more than one product', async () => {
    const productA = await productFixture();
    const category = await createCategory({
      slug: 'watches-2',
      nameAr: 'ساعات 2',
      nameEn: 'Watches 2',
    });
    const productB = await createProduct({
      product: { slug: 'watch-2', nameAr: 'ساعة 2', nameEn: 'Watch 2', categoryId: category.id },
      variants: [{ sku: 'WATCH-2', priceMinor: 20000 }],
    });
    const media = await uploadImage();

    await expect(attachProductImage(productA.id, media.id)).resolves.toBeTruthy();
    await expect(attachProductImage(productB.id, media.id)).resolves.toBeTruthy();
  });

  it('rejects attaching the same media asset to the same product twice', async () => {
    const product = await productFixture();
    const media = await uploadImage();
    await attachProductImage(product.id, media.id);
    await expect(attachProductImage(product.id, media.id)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('rejects a product that does not exist', async () => {
    const media = await uploadImage();
    await expect(
      attachProductImage('00000000-0000-0000-0000-000000000000', media.id),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects a media asset that does not exist', async () => {
    const product = await productFixture();
    await expect(
      attachProductImage(product.id, '00000000-0000-0000-0000-000000000000'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('detachProductImage', () => {
  it('removes the association, leaving the MediaAsset untouched', async () => {
    const product = await productFixture();
    const media = await uploadImage();
    const image = await attachProductImage(product.id, media.id);

    await detachProductImage(image.id);
    expect(await listProductImages(product.id)).toHaveLength(0);
  });

  it('promotes the next image to primary when the primary one is detached', async () => {
    const product = await productFixture();
    const first = await attachProductImage(product.id, (await uploadImage()).id);
    const second = await attachProductImage(product.id, (await uploadImage()).id);

    await detachProductImage(first.id);
    const remaining = await listProductImages(product.id);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.id).toBe(second.id);
    expect(remaining[0]?.isPrimary).toBe(true);
  });
});

describe('setPrimaryProductImage', () => {
  it('makes exactly one image primary at a time', async () => {
    const product = await productFixture();
    const first = await attachProductImage(product.id, (await uploadImage()).id);
    const second = await attachProductImage(product.id, (await uploadImage()).id);

    await setPrimaryProductImage(second.id);
    const images = await listProductImages(product.id);
    expect(images.filter((i) => i.isPrimary)).toHaveLength(1);
    expect(images.find((i) => i.id === second.id)?.isPrimary).toBe(true);
    expect(images.find((i) => i.id === first.id)?.isPrimary).toBe(false);
  });
});

describe('reorderProductImages', () => {
  it('applies the given order as position', async () => {
    const product = await productFixture();
    const a = await attachProductImage(product.id, (await uploadImage()).id);
    const b = await attachProductImage(product.id, (await uploadImage()).id);
    const c = await attachProductImage(product.id, (await uploadImage()).id);

    await reorderProductImages(product.id, [c.id, a.id, b.id]);

    const images = await listProductImages(product.id);
    expect(images.map((i) => i.id)).toEqual([c.id, a.id, b.id]);
  });

  it('rejects an order that omits or adds an image', async () => {
    const product = await productFixture();
    const a = await attachProductImage(product.id, (await uploadImage()).id);
    await attachProductImage(product.id, (await uploadImage()).id);

    await expect(reorderProductImages(product.id, [a.id])).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });
});
