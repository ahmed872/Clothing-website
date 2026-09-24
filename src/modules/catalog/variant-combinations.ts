import { AppError } from '@/modules/core';

import type { ProductOptionInput, VariantInput } from './schemas';

/**
 * Pure combinatorics for `ProductOption` → `Variant`. No database access —
 * every function here is a plain data transformation, which is what makes it
 * cheap to test exhaustively (see `variant-combinations.test.ts`) without a
 * Postgres instance.
 */

export interface OptionValueRef {
  optionNameEn: string;
  valueEn: string;
}

/** Every combination of one value per option, in stable order — the classic
 * cartesian product. `[[Black, White], [40, 41]]` → `[[Black,40], [Black,41],
 * [White,40], [White,41]]`. An empty `options` list yields exactly one empty
 * combination: the shape a simple product's single default variant needs. */
export function cartesianProduct(options: ProductOptionInput[]): OptionValueRef[][] {
  return options.reduce<OptionValueRef[][]>(
    (combinations, option) =>
      combinations.flatMap((combination) =>
        option.values.map((value) => [
          ...combination,
          { optionNameEn: option.nameEn, valueEn: value.valueEn },
        ]),
      ),
    [[]],
  );
}

function comboKey(combo: OptionValueRef[]): string {
  return [...combo]
    .sort((a, b) => a.optionNameEn.localeCompare(b.optionNameEn))
    .map((v) => `${v.optionNameEn}=${v.valueEn}`)
    .join('|');
}

/**
 * Matches each variant to the combination it represents and enforces that
 * the variants passed in are exactly the full combination set — no missing
 * combination, no duplicate, and every variant's `optionValues` names a real
 * option/value pair. Throws `VALIDATION_FAILED` (with every problem found,
 * not just the first) rather than silently dropping or ignoring a mismatch.
 */
export function matchVariantsToCombinations(
  options: ProductOptionInput[],
  variants: VariantInput[],
): { variant: VariantInput; combination: OptionValueRef[] }[] {
  const expected = cartesianProduct(options);

  if (options.length === 0) {
    if (variants.length !== 1) {
      throw new AppError('VALIDATION_FAILED', {
        details: { reason: 'A product with no options must have exactly one (default) variant' },
      });
    }
    return [{ variant: variants[0]!, combination: [] }];
  }

  const expectedByKey = new Map(expected.map((combo) => [comboKey(combo), combo]));
  const seenKeys = new Set<string>();
  const issues: string[] = [];
  const matched: { variant: VariantInput; combination: OptionValueRef[] }[] = [];

  for (const variant of variants) {
    const combo = variant.optionValues ?? [];
    const key = comboKey(combo);
    const expectedCombo = expectedByKey.get(key);

    if (!expectedCombo) {
      issues.push(`Variant "${variant.sku}" does not match any valid option combination`);
      continue;
    }
    if (seenKeys.has(key)) {
      issues.push(`Duplicate variant for combination: ${key}`);
      continue;
    }
    seenKeys.add(key);
    matched.push({ variant, combination: expectedCombo });
  }

  for (const combo of expected) {
    if (!seenKeys.has(comboKey(combo))) {
      issues.push(`Missing variant for combination: ${comboKey(combo)}`);
    }
  }

  if (issues.length > 0) {
    throw new AppError('VALIDATION_FAILED', { details: { issues } });
  }

  return matched;
}

/** A deterministic SKU from name parts — used by seed/migration scripts that
 * need one and don't have a business-assigned code. Not used when a caller
 * supplies their own SKU, which is the normal (admin-entered) case. */
export function generateSku(...parts: (string | number)[]): string {
  return parts
    .map((part) =>
      String(part)
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, ''),
    )
    .filter(Boolean)
    .join('-');
}
