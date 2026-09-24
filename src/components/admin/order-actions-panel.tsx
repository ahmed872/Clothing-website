'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import type { FulfillmentStatus, OrderStatus } from '@generated/prisma';

// The pure state machine, not the `@/modules/orders` barrel — see the note
// in checkout-client.tsx for why a client component cannot use the barrel.
import {
  canTransitionFulfillmentStatus,
  canTransitionOrderStatus,
  isOrderCancellable,
} from '@/modules/orders/order-status';
import type { Locale } from '@/lib/i18n/locales';
import { getAdminDictionary } from '@/lib/i18n/admin-dictionary';
import {
  advanceFulfillmentAction,
  advanceOrderAction,
  cancelOrderAction,
  type FulfillmentIntent,
  type OrderAdminIntent,
} from '@/lib/admin/order-actions';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';

/**
 * What an admin may do to this order, right now.
 *
 * The buttons shown are derived from the same state machine the server
 * enforces, so the UI cannot offer a move the domain would refuse. That is a
 * convenience, not the control: the server checks the permission and the
 * transition again on every call, and a hand-crafted request gets the same
 * refusal a hidden button would have (P10 §10/§31).
 *
 * There is no "mark as paid" button anywhere in this panel, deliberately —
 * see `order-actions.ts`.
 */

interface OrderActionsPanelProps {
  number: string;
  status: OrderStatus;
  fulfillmentStatus: FulfillmentStatus;
  locale: Locale;
}

export function OrderActionsPanel({
  number,
  status,
  fulfillmentStatus,
  locale,
}: OrderActionsPanelProps) {
  const t = getAdminDictionary(locale).ordersAdmin;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const ORDER_MOVES: { intent: OrderAdminIntent; to: OrderStatus; label: string }[] = [
    { intent: 'confirm', to: 'CONFIRMED', label: t.confirm },
    { intent: 'process', to: 'PROCESSING', label: t.startProcessing },
    { intent: 'complete', to: 'COMPLETED', label: t.complete },
  ];
  const orderMoves = ORDER_MOVES.filter((move) => canTransitionOrderStatus(status, move.to));

  const FULFILLMENT_MOVES: {
    intent: FulfillmentIntent;
    to: FulfillmentStatus;
    label: string;
  }[] = [
    { intent: 'prepare', to: 'PROCESSING', label: t.markProcessing },
    { intent: 'ship', to: 'SHIPPED', label: t.markShipped },
    { intent: 'deliver', to: 'DELIVERED', label: t.markDelivered },
  ];
  const fulfillmentMoves = FULFILLMENT_MOVES.filter((move) =>
    canTransitionFulfillmentStatus(fulfillmentStatus, move.to),
  );

  const cancellable = isOrderCancellable(status);
  const hasAnything = orderMoves.length > 0 || fulfillmentMoves.length > 0 || cancellable;

  function run(action: () => Promise<{ ok: boolean; error?: string }>, successMessage: string) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        toast({ title: successMessage, variant: 'success' });
        router.refresh();
        return;
      }
      setError(t.updateFailed);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {error ? <Alert variant="error">{error}</Alert> : null}

      {hasAnything ? (
        <div className="flex flex-wrap gap-2">
          {orderMoves.map((move) => (
            <Button
              key={move.intent}
              size="sm"
              disabled={pending}
              onClick={() => run(() => advanceOrderAction(number, move.intent), t.updated)}
            >
              {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              {move.label}
            </Button>
          ))}

          {fulfillmentMoves.map((move) => (
            <Button
              key={move.intent}
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => run(() => advanceFulfillmentAction(number, move.intent), t.updated)}
            >
              {move.label}
            </Button>
          ))}

          {cancellable ? (
            <Button
              size="sm"
              variant="outline"
              className="text-(--color-error)"
              disabled={pending}
              onClick={() => setCancelOpen(true)}
            >
              {t.cancel}
            </Button>
          ) : null}
        </div>
      ) : (
        <p className="text-small text-(--color-text-muted)">{t.noActions}</p>
      )}

      {/* Cancellation restores stock and cannot be undone, so it is the one
          action behind an explicit confirmation (P10 §16). */}
      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t.cancelTitle}</DialogTitle>
            <DialogDescription>{t.cancelBody}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="cancel-reason" className="text-label text-(--color-text)">
              {t.cancel}
            </label>
            <Textarea
              id="cancel-reason"
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              disabled={pending}
            />
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setCancelOpen(false)} disabled={pending}>
              {getAdminDictionary(locale).common.cancel}
            </Button>
            <Button
              variant="outline"
              className="text-(--color-error)"
              disabled={pending}
              onClick={() => {
                setCancelOpen(false);
                run(async () => {
                  const result = await cancelOrderAction(number, reason);
                  return result;
                }, t.cancelled);
              }}
            >
              {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              {t.cancelConfirmCta}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
