import { NextResponse } from 'next/server';

import { toAppError } from '@/modules/core';
import { requestUpload } from '@/modules/media';
import { requirePermission } from '@/modules/identity';
import { permissionForUploadContext } from '@/lib/admin/media-context-permission';

/**
 * "Client → request signed upload" (P04, authorized as of P07). Validates
 * the *declared* content-type/size and rejects anything outside
 * `ALLOWED_IMAGE_MIME_TYPES` before a signed URL is ever issued — the real,
 * authoritative check on the actual bytes happens at `/api/media/uploads`
 * (confirm), since nothing this route receives can be trusted yet.
 *
 * Authorization is resolved from `context` (`product`/`category`/`brand`/…)
 * against the exact P06 permission that governs that resource — an unknown
 * context is rejected before `requestUpload` (and thus before a signed URL
 * is ever issued) rather than silently defaulting to "allowed."
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json();
    const permission = permissionForUploadContext(body?.context);
    if (!permission) {
      return NextResponse.json(
        { code: 'VALIDATION_FAILED', message: 'Unknown upload context' },
        { status: 422 },
      );
    }
    await requirePermission(permission);

    const signedUpload = await requestUpload(body);
    return NextResponse.json(signedUpload, { status: 201 });
  } catch (error) {
    const appError = toAppError(error);
    return NextResponse.json(
      { code: appError.code, message: appError.messageFor('ar') },
      { status: appError.httpStatus },
    );
  }
}
