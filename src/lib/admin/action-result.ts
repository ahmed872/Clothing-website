/**
 * The one return shape every P07 admin server action uses: `requirePermission`
 * first, then the domain service, then an audit event, then revalidate —
 * returned as a plain object (never a thrown error crossing back to the
 * client) so the calling form reads `.error` and shows it inline, the same
 * ergonomics `loginAction` (P06) established. A dedicated file rather than
 * living inside one of the `*-actions.ts` files: those are `'use server'`
 * modules, and importing a type from one doesn't touch its runtime export
 * surface, but there's no reason to couple every entity's actions to
 * brand-actions.ts for a shared type either.
 */
export interface ActionResult<T = undefined> {
  ok: boolean;
  data?: T;
  error?: string;
}
