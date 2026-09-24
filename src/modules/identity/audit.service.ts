import 'server-only';

import type { Prisma } from '@generated/prisma';

import { db } from '@/modules/core';

/**
 * Identity-relevant events on the existing `AuditLog` table (no schema
 * change needed — it was already generic: `action` + `entityType` +
 * `entityId` + optional before/after snapshots).
 *
 * Never pass a password, token, or hash into `before`/`after` — this log is
 * read by admins investigating account activity, not a place secrets ever
 * belong, even hashed.
 */

export type AuditAction =
  | 'auth.login.success'
  | 'auth.login.failure'
  | 'auth.logout'
  | 'user.role_changed'
  | 'user.disabled'
  | 'user.enabled'
  | 'user.created'
  // P07 — admin catalog management. `userId` here is always the actor (the
  // admin who did it); catalog rows have no "subject user" the way an
  // account event does.
  | 'product.created'
  | 'product.updated'
  | 'product.published'
  | 'product.archived'
  | 'product.deleted'
  | 'category.created'
  | 'category.updated'
  | 'category.deleted'
  | 'brand.created'
  | 'brand.updated'
  | 'brand.deleted'
  | 'attribute_definition.created'
  | 'attribute_definition.updated'
  | 'attribute_definition.deleted'
  | 'variant.created'
  | 'variant.updated'
  | 'variant.deleted'
  // P08 — inventory and pricing. Stock and price are the two numbers a
  // dispute is argued over, so each movement is its own event rather than a
  // generic `variant.updated`: "who set this to 3, and why" has to be
  // answerable from the log alone.
  | 'inventory.adjusted'
  | 'inventory.policy_changed'
  | 'price.updated'
  | 'price.bulk_updated'
  // P09 — promotions. A discount rule is a commercial commitment, so who
  // created it, who changed its value or window, and who switched it on or
  // off all have to be answerable from the log.
  | 'promotion.created'
  | 'promotion.updated'
  | 'promotion.activated'
  | 'promotion.deactivated'
  | 'promotion.deleted'
  // P10 — orders. An order is the record a dispute is argued over, so every
  // change of hands is logged: who confirmed it, who cancelled it, who moved
  // the shipment along. `order.created` has a null actor when the customer
  // placed it themselves — there is no admin to name.
  | 'order.created'
  | 'order.status_changed'
  | 'order.cancelled'
  | 'order.fulfillment_changed'
  // P11. A null actor here is the normal case, not a gap: the mover is a
  // verified provider event, and a provider is not a user.
  | 'order.payment_changed'
  // P12 — storefront customer identity, kept in its own vocabulary rather
  // than reusing `auth.login.*`/`auth.logout`: those are the admin
  // surface's events, and conflating the two would make "who signed in"
  // ambiguous between two completely separate authentication systems.
  | 'customer.registered'
  | 'customer.login.success'
  | 'customer.login.failure'
  | 'customer.logout'
  | 'customer.profile_updated'
  | 'customer.email_verification_requested'
  | 'customer.email_verified'
  | 'customer.password_reset_requested'
  | 'customer.password_reset_completed'
  // P15 — the store's own configuration and its homepage. Both are
  // store-wide: one row and one ordered list that every visitor sees, so
  // "who changed the currency" and "who took the hero down" have to be
  // answerable the same way a price change already is.
  | 'settings.updated'
  | 'content.section_created'
  | 'content.section_updated'
  | 'content.section_deleted'
  | 'content.section_enabled'
  | 'content.section_disabled'
  | 'content.section_published'
  | 'content.sections_reordered';

/** Every entity type an audit event can be about — `entityType` is a plain
 * string column at the DB level (no enum constraint), but a fixed union
 * here keeps every call site naming a real, spelled-consistently type
 * rather than free-typing "Products" in one place and "product" in another. */
export type AuditEntityType =
  | 'User'
  | 'Product'
  | 'Category'
  | 'Brand'
  | 'AttributeDefinition'
  | 'Variant'
  | 'Coupon'
  | 'Order'
  // P15. `StoreSettings` is a single row, so its `entityId` is that row's
  // id rather than a choice; `HomepageSection` names one section.
  | 'StoreSettings'
  | 'HomepageSection';

export interface RecordAuditEventInput {
  action: AuditAction;
  /** Defaults to `'User'` — every P06 call site is a `User`-subject event
   * and none of them pass this explicitly; P07's catalog events always do. */
  entityType?: AuditEntityType;
  /** The user the event happened to (subject) for a `User`-entityType event,
   * or the acting admin for every other entity type. Nullable because a
   * failed login against an email that doesn't exist has no user row to
   * attach to. */
  userId?: string | null;
  entityId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  ip?: string | null;
}

export async function recordAuditEvent(input: RecordAuditEventInput): Promise<void> {
  await recordAuditEventWithin(db, input);
}

/**
 * The same write, joined to a transaction the caller already owns.
 *
 * Order finalization writes its audit entry inside the same transaction that
 * creates the order (P10 §23), so the log cannot record an order that was
 * rolled back, and an order cannot exist with no record of who placed it.
 */
export async function recordAuditEventWithin(
  client: Prisma.TransactionClient | typeof db,
  input: RecordAuditEventInput,
): Promise<void> {
  await client.auditLog.create({
    data: {
      action: input.action,
      entityType: input.entityType ?? 'User',
      entityId: input.entityId ?? input.userId ?? null,
      userId: input.userId ?? null,
      before: input.before as Prisma.InputJsonValue | undefined,
      after: input.after as Prisma.InputJsonValue | undefined,
      ip: input.ip ?? null,
    },
  });
}
