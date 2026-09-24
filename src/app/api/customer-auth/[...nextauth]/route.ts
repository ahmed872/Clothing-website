/**
 * The storefront customer auth instance's own endpoint — a separate mount
 * from `/api/auth/[...nextauth]` (the admin instance), matching
 * `customer-auth.ts`'s `basePath: '/api/customer-auth'`. Two different
 * route trees for two different audiences, the same way the two instances
 * already use two different cookie names.
 */
import { customerHandlers } from '@/modules/identity';

export const { GET, POST } = customerHandlers;
