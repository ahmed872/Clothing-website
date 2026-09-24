import type { Permission } from '@/modules/identity';
import type { UploadContext } from '@/modules/media';

/**
 * P04's upload routes were deliberately left unauthenticated ("there is no
 * user-auth system yet — that's P06"). Now that P06 exists and P07 is the
 * first real caller, every upload must be authorized by the same permission
 * that governs the resource it's for — uploading a product image without
 * `products.update` would otherwise be a hole no admin-shell nav link ever
 * pointed at, but a direct POST could still reach.
 */
export const MEDIA_CONTEXT_PERMISSION: Record<UploadContext, Permission> = {
  product: 'products.update',
  category: 'categories.manage',
  brand: 'brands.manage',
  homepage: 'content.manage',
  branding: 'settings.manage',
};

export function permissionForUploadContext(context: string): Permission | null {
  return (MEDIA_CONTEXT_PERMISSION as Record<string, Permission>)[context] ?? null;
}
