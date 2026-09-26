/**
 * `fitting` — the virtual fitting room's domain (clothing P04): a garment
 * in a chosen colour and size, on a customer's measurements, as structured
 * data a renderer draws and a page explains.
 *
 * May depend on: body-profile, sizing
 * Must not depend on: identity, customers, catalog, orders
 *
 * Pure: it is handed the profile, the product's chart and style, and the
 * selection, by a caller that took the customer from the session and the
 * product from the catalog (`lib/fitting/fitting-room.ts`). Nothing here
 * reads the database, stores an image or calls out.
 *
 * Other modules import `@/modules/fitting`, never a file inside it.
 */

export {
  LocalVirtualFittingService,
  virtualFittingService,
  type VirtualFittingService,
  type FittingInput,
  type FittingProduct,
  type FittingColor,
  type FittingResult,
  type FittingRecommendation,
  type SizeRelation,
} from './virtual-fitting.service';
