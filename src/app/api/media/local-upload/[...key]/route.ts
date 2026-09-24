import { NextResponse } from 'next/server';

import { toAppError } from '@/modules/core';
import { getStorageProvider, handleLocalUploadPut } from '@/modules/media';

/**
 * Local-provider only (`STORAGE_PROVIDER=local`, the dev/test default): the
 * upload target a signed local URL points at, and the "CDN" a local
 * `getPublicUrl` points back at (GET). Both are dev/test infrastructure —
 * there is no real object store to upload directly to or serve from without
 * one, so bytes pass through this route instead. In production
 * (`STORAGE_PROVIDER=s3`) this route is never reached: uploads and reads go
 * straight to the bucket, through `S3StorageProvider`.
 */

function joinKey(key: string[]): string {
  return key.join('/');
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ key: string[] }> },
): Promise<Response> {
  try {
    const { key } = await params;
    const url = new URL(request.url);
    const contentType = url.searchParams.get('contentType');
    const maxSizeBytes = url.searchParams.get('maxSizeBytes');
    const expiresAtMs = url.searchParams.get('expiresAtMs');
    const signature = url.searchParams.get('signature');

    if (!contentType || !maxSizeBytes || !expiresAtMs || !signature) {
      return NextResponse.json(
        { code: 'VALIDATION_FAILED', message: 'Missing signed URL parameters' },
        { status: 422 },
      );
    }

    const body = Buffer.from(await request.arrayBuffer());
    await handleLocalUploadPut({
      key: joinKey(key),
      contentType,
      maxSizeBytes: Number(maxSizeBytes),
      expiresAtMs: Number(expiresAtMs),
      signature,
      body,
    });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const appError = toAppError(error);
    return NextResponse.json(
      { code: appError.code, message: appError.messageFor('ar') },
      { status: appError.httpStatus },
    );
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ key: string[] }> },
): Promise<Response> {
  const { key } = await params;
  const provider = getStorageProvider();
  const joined = joinKey(key);

  const head = await provider.headObject(joined);
  if (!head) return new NextResponse(null, { status: 404 });

  const buffer = await provider.getObjectBuffer(joined);
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': head.contentType,
      'Content-Length': String(head.sizeBytes),
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
