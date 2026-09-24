import { z } from 'zod';
import { Prisma, type AttributeDefinition } from '@generated/prisma';

import { db } from '@/modules/core';
import { AppError } from '@/modules/core';

import { getAncestorChain } from './category.service';
import {
  attributeDefinitionInputSchema,
  attributeDefinitionUpdateSchema,
  type AttributeDefinitionInput,
  type AttributeDefinitionUpdateInput,
} from './schemas';
import { mapUniqueConstraint } from './prisma-errors';

/** Prisma's JSON columns need the `Prisma.JsonNull` sentinel for an explicit
 * null, not the plain JS value — a `T | null | undefined` from Zod needs this
 * translation at every write. */
function jsonInput<T>(value: T | null | undefined): T | typeof Prisma.JsonNull | undefined {
  return value === null ? Prisma.JsonNull : value;
}

/**
 * Attribute definitions and the Hybrid Attribute Model's dynamic validation.
 *
 * Inheritance rule (the "override rule" the Blueprint calls for): a
 * category's *effective* attribute set is every definition on every ancestor
 * plus its own, keyed by `key`. Walking from the root down to the category
 * itself and letting each level overwrite the same key means a descendant's
 * definition always wins over an ancestor's for that key — the descendant is
 * the more specific rule, the same way CSS or object spread work. This is
 * computed at read time, never duplicated into a child row, so there is
 * exactly one place a key's definition can be edited for it to take effect
 * everywhere it's inherited.
 */

export async function createAttributeDefinition(
  input: AttributeDefinitionInput,
): Promise<AttributeDefinition> {
  const parsed = attributeDefinitionInputSchema.parse(input);
  const category = await db.category.findUnique({ where: { id: parsed.categoryId } });
  if (!category)
    throw new AppError('NOT_FOUND', { details: { entity: 'Category', id: parsed.categoryId } });

  try {
    return await db.attributeDefinition.create({
      data: { ...parsed, allowedValues: jsonInput(parsed.allowedValues) },
    });
  } catch (error) {
    throw mapUniqueConstraint(error, 'key');
  }
}

export async function updateAttributeDefinition(
  id: string,
  input: AttributeDefinitionUpdateInput,
): Promise<AttributeDefinition> {
  const parsed = attributeDefinitionUpdateSchema.parse(input);
  const existing = await db.attributeDefinition.findUnique({ where: { id } });
  if (!existing)
    throw new AppError('NOT_FOUND', { details: { entity: 'AttributeDefinition', id } });

  const nextType = parsed.type ?? existing.type;
  const needsAllowedValues = nextType === 'SELECT' || nextType === 'MULTI_SELECT';
  const nextAllowedValues =
    parsed.allowedValues !== undefined ? parsed.allowedValues : existing.allowedValues;
  if (needsAllowedValues && (!nextAllowedValues || (nextAllowedValues as unknown[]).length === 0)) {
    throw new AppError('VALIDATION_FAILED', {
      details: { reason: `allowedValues is required for a ${nextType} attribute` },
    });
  }

  return db.attributeDefinition.update({
    where: { id },
    data: { ...parsed, allowedValues: jsonInput(parsed.allowedValues) },
  });
}

/** Removes an attribute definition. Safe by construction: `Product.attributes`
 * is a JSON blob, not a foreign key, so no row anywhere points at this one —
 * a product that already stored a value for this key simply keeps it
 * un-validated going forward (the same "an old stored value stays as
 * historical data, not something a later schema change corrupts" posture
 * `validateProductAttributes` only ever applies at write time). */
export async function deleteAttributeDefinition(id: string): Promise<void> {
  const existing = await db.attributeDefinition.findUnique({ where: { id } });
  if (!existing)
    throw new AppError('NOT_FOUND', { details: { entity: 'AttributeDefinition', id } });
  await db.attributeDefinition.delete({ where: { id } });
}

export async function listAttributeDefinitions(categoryId: string): Promise<AttributeDefinition[]> {
  return db.attributeDefinition.findMany({
    where: { categoryId },
    orderBy: { displayOrder: 'asc' },
  });
}

/** The attribute definitions that actually apply to `categoryId`: its own
 * plus every ancestor's, with a descendant's definition replacing an
 * ancestor's for the same `key` (see module docstring). */
export async function getEffectiveAttributeDefinitions(
  categoryId: string,
): Promise<AttributeDefinition[]> {
  const chain = await getAncestorChain(categoryId); // root -> ... -> categoryId
  const byKey = new Map<string, AttributeDefinition>();

  for (const category of chain) {
    const definitions = await db.attributeDefinition.findMany({
      where: { categoryId: category.id },
    });
    for (const definition of definitions) {
      byKey.set(definition.key, definition);
    }
  }

  return [...byKey.values()].sort((a, b) => a.displayOrder - b.displayOrder);
}

/** Builds a Zod schema from a category's effective attribute definitions —
 * this is the "product form knows automatically what's required" behaviour:
 * the schema is derived from data, never hand-written per category. Unknown
 * keys are rejected (`.strict()`) so the JSONB column can't accumulate values
 * that don't correspond to any definition. */
export function buildAttributesSchema(
  definitions: AttributeDefinition[],
): z.ZodType<Record<string, unknown>> {
  const shape: Record<string, z.ZodType> = {};

  for (const definition of definitions) {
    const allowedValues = (definition.allowedValues as string[] | null) ?? [];
    let field: z.ZodType;

    switch (definition.type) {
      case 'TEXT':
        field = z.string().min(1);
        break;
      case 'NUMBER':
        field = z.number();
        break;
      case 'BOOLEAN':
        field = z.boolean();
        break;
      case 'SELECT':
        field = z.enum(allowedValues as [string, ...string[]]);
        break;
      case 'MULTI_SELECT':
        field = z.array(z.enum(allowedValues as [string, ...string[]])).min(1);
        break;
    }

    shape[definition.key] = definition.required ? field : field.optional();
  }

  return z.object(shape).strict();
}

/** Validates a product's `attributes` JSON against its category's effective
 * definitions. Server-side only, by construction — there is no client-side
 * counterpart to fall back on, so this is the one place a value is accepted
 * or rejected. */
export async function validateProductAttributes(
  categoryId: string,
  attributes: unknown,
): Promise<Record<string, unknown>> {
  const definitions = await getEffectiveAttributeDefinitions(categoryId);
  const schema = buildAttributesSchema(definitions);
  const result = schema.safeParse(attributes ?? {});

  if (!result.success) {
    throw new AppError('VALIDATION_FAILED', {
      cause: result.error,
      details: {
        issues: result.error.issues.map((issue) => ({ path: issue.path, message: issue.message })),
      },
    });
  }

  return result.data;
}
