import { NextResponse } from 'next/server';

import { toAppError } from '@/modules/core';
import { confirmUpload, getMediaPublicUrl } from '@/modules/media';
import { requirePermission } from '@/modules/identity';
import { permissionForUploadContext } from '@/lib/admin/media-context-permission';

/**
 * "… → direct upload → server confirmation → MediaAsset persistence" (P04,
 * authorized as of P07). Re-reads whatever actually landed at `key` from the
 * storage provider and decodes it — the client's `confirmUpload` call
 * carries no content-type or size, because none of that is trusted here;
 * the only trusted input is the key, and the provider's own view of what's
 * stored at it.
 *
 * The permission check here is defense in depth on top of the one already
 * done at `/api/media/upload-requests`: the key's own `media/<context>/…`
 * shape (server-generated, never client-supplied — see
 * `media-asset.service.ts#requestUpload`) names which permission this
 * specific confirm call needs, checked again independently rather than
 * trusting that whoever got the signed URL is the same caller confirming it.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json();
    const context = typeof body?.key === 'string' ? body.key.split('/')[1] : undefined;
    const permission = permissionForUploadContext(context ?? '');
    if (!permission) {
      return NextResponse.json(
        { code: 'VALIDATION_FAILED', message: 'Unknown upload context' },
        { status: 422 },
      );
    }
    await requirePermission(permission);

    const asset = await confirmUpload(
      { key: body?.key },
      { altAr: body?.altAr, altEn: body?.altEn },
    );
    // The client needs a displayable URL and has no business calling
    // `getStorageProvider()` itself — resolved here, once, server-side.
    return NextResponse.json({ ...asset, src: getMediaPublicUrl(asset) }, { status: 201 });
  } catch (error) {
    const appError = toAppError(error);
    return NextResponse.json(
      { code: appError.code, message: appError.messageFor('ar') },
      { status: appError.httpStatus },
    );
  }
}
