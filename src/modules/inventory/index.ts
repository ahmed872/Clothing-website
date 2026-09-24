/**
 * `inventory` — stock levels and the adjustment history. Sole owner of stock writes.
 *
 * May depend on: core, catalog
 * Must not depend on: orders — orders call inventory, never the reverse
 *
 * Every change to `Variant.stockQuantity` goes through `adjustStock`, in a
 * transaction that locks the row, moves the quantity and records why — so
 * the counter and its history can never disagree, and two admins adjusting
 * the same variant at once cannot lose each other's work. `catalog`'s
 * `updateVariant` refuses the stock field precisely so that this is the
 * only path.
 *
 * Reading variant rows is not this module's job: the admin inventory screen
 * lists them through `catalog`'s `listVariantsForAdmin`, the same query the
 * pricing screen uses. Owning the writes does not require a second read
 * path that would drift from it.
 *
 * Other modules import `@/modules/inventory`, never a file inside it.
 */

export {
  adjustStock,
  consumeStockForOrderWithin,
  restoreStockForOrderWithin,
  setInventoryPolicy,
  listAdjustments,
  MANUAL_INVENTORY_REASONS,
  adjustStockInputSchema,
  inventoryPolicyInputSchema,
  type AdjustStockInput,
  type ManualInventoryReason,
  type StockAdjustmentResult,
  type InventoryPolicyInput,
  type AdjustmentHistoryQuery,
  type AdjustmentHistoryItem,
  type AdjustmentHistoryResult,
} from './inventory.service';
