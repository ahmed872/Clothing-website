/**
 * P04 media migration: every MediaAsset still pointing at an external URL
 * (`provider: EXTERNAL` — what P03's cars.json migration created, since P03
 * explicitly deferred real storage to this phase) gets downloaded, verified,
 * and re-uploaded into real storage. Nothing keeps referencing Unsplash
 * afterwards.
 *
 * Run with: pnpm db:migrate-media
 *
 * Per-asset, not all-or-nothing: one failed download does not abort the
 * others, and a failure never produces a fake/placeholder asset — the row
 * is left exactly as it was (still EXTERNAL, still safe to retry later) and
 * the failure is reported by URL and reason. Content-hash deduplication
 * (same rule as `media-asset.service.ts#confirmUpload`) means two source
 * URLs that happen to be the same image end up as one MediaAsset row, with
 * every reference repointed to it and the redundant row removed — the same
 * problem the P03 report already flagged for exact-URL duplicates, handled
 * here for byte-identical content from *different* URLs too.
 */

import { createHash, randomUUID } from 'node:crypto';

import { config as loadDotenv } from 'dotenv';

loadDotenv({ path: process.env.NODE_ENV === 'test' ? '.env.test' : '.env', quiet: true });

const { db } = await import('../src/modules/core/index.js');
const { getStorageProvider } = await import('../src/modules/media/provider-factory.js');
const { sniffImage } = await import('../src/modules/media/validation.js');
const { extensionForMime } = await import('../src/modules/media/local-provider.js');

interface FailedDownload {
  mediaAssetId: string;
  url: string;
  reason: string;
}

async function downloadUrl(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function main() {
  const provider = getStorageProvider();
  const pending = await db.mediaAsset.findMany({ where: { provider: 'EXTERNAL' } });

  console.log(`Found ${pending.length} MediaAsset row(s) still pointing at an external URL.`);
  console.log(`Target storage provider: ${provider.name}\n`);

  let migrated = 0;
  let deduplicated = 0;
  const failed: FailedDownload[] = [];

  for (const asset of pending) {
    const sourceUrl = asset.storageKey;
    let buffer: Buffer;
    try {
      buffer = await downloadUrl(sourceUrl);
    } catch (error) {
      failed.push({
        mediaAssetId: asset.id,
        url: sourceUrl,
        reason: `Download failed: ${(error as Error).message}`,
      });
      continue;
    }

    const sniffed = await sniffImage(buffer);
    if (!sniffed) {
      failed.push({
        mediaAssetId: asset.id,
        url: sourceUrl,
        reason: 'Downloaded content is not a valid JPEG, PNG, or WebP image',
      });
      continue;
    }

    const contentHash = createHash('sha256').update(buffer).digest('hex');

    const duplicate = await db.mediaAsset.findFirst({
      where: { contentHash, id: { not: asset.id } },
    });
    if (duplicate) {
      // Same bytes as an asset already migrated (possibly from a different
      // source URL) — repoint every reference to the surviving row and
      // remove this one, rather than storing (and tracking) a second copy.
      await db.$transaction([
        db.productImage.updateMany({
          where: { mediaId: asset.id },
          data: { mediaId: duplicate.id },
        }),
        db.category.updateMany({
          where: { imageMediaId: asset.id },
          data: { imageMediaId: duplicate.id },
        }),
        db.brand.updateMany({
          where: { logoMediaId: asset.id },
          data: { logoMediaId: duplicate.id },
        }),
        db.mediaAsset.delete({ where: { id: asset.id } }),
      ]);
      deduplicated += 1;
      console.log(`  dedup: ${sourceUrl}\n    -> reused existing asset ${duplicate.id}`);
      continue;
    }

    const newKey = `media/migrated/${randomUUID()}.${extensionForMime(sniffed.mime)}`;
    await provider.putObjectBuffer(newKey, buffer, sniffed.mime);

    await db.mediaAsset.update({
      where: { id: asset.id },
      data: {
        provider: provider.name,
        storageKey: newKey,
        contentHash,
        mime: sniffed.mime,
        sizeBytes: buffer.byteLength,
        width: sniffed.width,
        height: sniffed.height,
      },
    });
    migrated += 1;
    console.log(
      `  ok: ${sourceUrl}\n    -> ${newKey} (${sniffed.mime}, ${sniffed.width}x${sniffed.height}, ${buffer.byteLength} bytes)`,
    );
  }

  console.log('\n--- Media migration summary ---');
  console.log(`Migrated to real storage: ${migrated}`);
  console.log(`Deduplicated (same content, different URL): ${deduplicated}`);
  console.log(`Failed: ${failed.length}`);
  console.log(`Still EXTERNAL (unchanged): ${failed.length}`);

  if (failed.length > 0) {
    console.log(
      '\nFailed downloads (URL, reason) — left as EXTERNAL, not migrated, no asset was fabricated:',
    );
    for (const f of failed) {
      console.log(`  - ${f.url}`);
      console.log(`    MediaAsset ${f.mediaAssetId}: ${f.reason}`);
    }
    process.exitCode = 1;
  }
}

await main();
await db.$disconnect();
