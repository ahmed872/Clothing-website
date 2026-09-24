'use server';

import { revalidatePath } from 'next/cache';

import { adminErrorMessage } from '@/lib/admin/admin-error-message';
import { requirePermission } from '@/modules/identity';
import { recordAuditEvent } from '@/modules/identity';
import {
  createAttributeDefinition,
  updateAttributeDefinition,
  deleteAttributeDefinition,
  type AttributeDefinitionInput,
  type AttributeDefinitionUpdateInput,
} from '@/modules/catalog';
import type { Locale } from '@/lib/i18n/locales';
import type { ActionResult } from '@/lib/admin/action-result';

/**
 * Attribute definitions live under `categories.manage` — P07 §5/§15 treats
 * "configure attributes" as part of category management, not a separate
 * permission, so there's no `attributes.manage` in P06's fixed 16-permission
 * set and none is needed: the category owner already governs its schema.
 */

export async function createAttributeDefinitionAction(
  input: AttributeDefinitionInput,
  locale: Locale,
): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission('categories.manage');
    const definition = await createAttributeDefinition(input);
    await recordAuditEvent({
      action: 'attribute_definition.created',
      entityType: 'AttributeDefinition',
      userId: user.id,
      entityId: definition.id,
      after: { categoryId: definition.categoryId, key: definition.key, type: definition.type },
    });
    revalidatePath(`/admin/categories/${input.categoryId}`);
    return { ok: true, data: { id: definition.id } };
  } catch (error) {
    return { ok: false, error: adminErrorMessage(error, locale) };
  }
}

export async function updateAttributeDefinitionAction(
  id: string,
  categoryId: string,
  input: AttributeDefinitionUpdateInput,
  locale: Locale,
): Promise<ActionResult> {
  try {
    const user = await requirePermission('categories.manage');
    const definition = await updateAttributeDefinition(id, input);
    await recordAuditEvent({
      action: 'attribute_definition.updated',
      entityType: 'AttributeDefinition',
      userId: user.id,
      entityId: definition.id,
      after: input as Record<string, unknown>,
    });
    revalidatePath(`/admin/categories/${categoryId}`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: adminErrorMessage(error, locale) };
  }
}

export async function deleteAttributeDefinitionAction(
  id: string,
  categoryId: string,
  locale: Locale,
): Promise<ActionResult> {
  try {
    const user = await requirePermission('categories.manage');
    await deleteAttributeDefinition(id);
    await recordAuditEvent({
      action: 'attribute_definition.deleted',
      entityType: 'AttributeDefinition',
      userId: user.id,
      entityId: id,
    });
    revalidatePath(`/admin/categories/${categoryId}`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: adminErrorMessage(error, locale) };
  }
}
