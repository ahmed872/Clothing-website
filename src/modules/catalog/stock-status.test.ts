import { describe, expect, it } from 'vitest';

import { resolveVariantStockStatus } from './stock-status';

describe('resolveVariantStockStatus', () => {
  it('is always in-stock when inventory is not tracked, regardless of quantity', () => {
    expect(
      resolveVariantStockStatus({ trackInventory: false, stockQuantity: 0, lowStockThreshold: 5 }),
    ).toBe('in-stock');
  });

  it('is out-of-stock at zero quantity', () => {
    expect(
      resolveVariantStockStatus({ trackInventory: true, stockQuantity: 0, lowStockThreshold: 5 }),
    ).toBe('out-of-stock');
  });

  it('is low-stock at or below the threshold, above zero', () => {
    expect(
      resolveVariantStockStatus({ trackInventory: true, stockQuantity: 3, lowStockThreshold: 5 }),
    ).toBe('low-stock');
    expect(
      resolveVariantStockStatus({ trackInventory: true, stockQuantity: 5, lowStockThreshold: 5 }),
    ).toBe('low-stock');
  });

  it('is in-stock above the threshold', () => {
    expect(
      resolveVariantStockStatus({ trackInventory: true, stockQuantity: 6, lowStockThreshold: 5 }),
    ).toBe('in-stock');
  });

  it('is in-stock when the threshold is zero and quantity is positive', () => {
    expect(
      resolveVariantStockStatus({ trackInventory: true, stockQuantity: 1, lowStockThreshold: 0 }),
    ).toBe('in-stock');
  });
});
