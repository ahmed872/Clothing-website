'use client';

import * as React from 'react';
import { Direction, Toast as RadixToast } from 'radix-ui';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Imperative toasts: `toast({ title, variant })` from anywhere, rendered by
 * the single `<Toaster />` mounted once near the app root. A minimal
 * module-level store (no context needed) keeps this callable from event
 * handlers, not just component bodies.
 */

export type ToastVariant = 'default' | 'success' | 'warning' | 'error';

interface ToastRecord {
  id: string;
  title: string;
  description?: string;
  variant: ToastVariant;
}

type Listener = (toasts: ToastRecord[]) => void;

let toasts: ToastRecord[] = [];
const listeners = new Set<Listener>();

function emit() {
  for (const listener of listeners) listener(toasts);
}

export function toast(input: { title: string; description?: string; variant?: ToastVariant }) {
  const id = crypto.randomUUID();
  toasts = [...toasts, { id, variant: 'default', ...input }];
  emit();
  return id;
}

export function dismissToast(id: string) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

function useToasts() {
  const [state, setState] = React.useState(toasts);
  React.useEffect(() => {
    listeners.add(setState);
    return () => {
      listeners.delete(setState);
    };
  }, []);
  return state;
}

const VARIANT_ICON = {
  default: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
};
const VARIANT_TONE: Record<ToastVariant, string> = {
  default: 'text-(--color-text)',
  success: 'text-(--color-success)',
  warning: 'text-(--color-warning)',
  error: 'text-(--color-error)',
};

export interface ToasterProps {
  /** The close button's screen-reader-only label, applied to every toast. Defaults to Arabic (the store default locale). */
  closeLabel?: string;
}

export function Toaster({ closeLabel = 'إغلاق' }: ToasterProps = {}) {
  const active = useToasts();
  // Radix's `SwipeDirection` is physical (`left`/`right`), not logical — the
  // viewport is anchored at the inline end (see `end-0` below), so the swipe
  // that dismisses it has to point the same physical way the direction flips.
  const dir = Direction.useDirection();
  const swipeDirection = dir === 'rtl' ? 'left' : 'right';

  return (
    <RadixToast.Provider swipeDirection={swipeDirection} duration={5000}>
      {active.map((item) => {
        const Icon = VARIANT_ICON[item.variant];
        return (
          <RadixToast.Root
            key={item.id}
            onOpenChange={(open) => {
              if (!open) dismissToast(item.id);
            }}
            className={cn(
              'grid grid-cols-[auto_1fr_auto] items-start gap-3 rounded-(--radius-control) border border-(--color-border) ' +
                'bg-(--color-elevated) p-4 shadow-(--shadow-lg)',
              'data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom-2 data-[state=open]:fade-in-0',
              'data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
              'data-[swipe=move]:translate-x-(--radix-toast-swipe-move-x) data-[swipe=end]:animate-out',
            )}
          >
            <Icon
              className={cn('mt-0.5 size-4.5', VARIANT_TONE[item.variant])}
              aria-hidden="true"
            />
            <div className="flex flex-col gap-0.5">
              <RadixToast.Title className="text-sm font-medium text-(--color-text)">
                {item.title}
              </RadixToast.Title>
              {item.description ? (
                <RadixToast.Description className="text-small text-(--color-text-muted)">
                  {item.description}
                </RadixToast.Description>
              ) : null}
            </div>
            <RadixToast.Close
              className="text-(--color-text-muted) transition-colors duration-(--duration-fast) hover:text-(--color-text)"
              aria-label={closeLabel}
            >
              <X className="size-4" aria-hidden="true" />
            </RadixToast.Close>
          </RadixToast.Root>
        );
      })}
      <RadixToast.Viewport className="fixed bottom-0 end-0 z-100 flex w-full max-w-sm flex-col gap-2 p-6 outline-none" />
    </RadixToast.Provider>
  );
}
