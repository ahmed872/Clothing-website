'use client';

import { useTransition } from 'react';

import { resendVerificationAction } from '@/lib/customers/customer-actions';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';

export function ResendVerificationButton({
  label,
  sendingLabel,
  successMessage,
}: {
  label: string;
  sendingLabel: string;
  successMessage: string;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={isPending}
      onClick={() => {
        startTransition(async () => {
          const result = await resendVerificationAction();
          if (result.ok) {
            toast({ title: successMessage, variant: 'success' });
          }
        });
      }}
    >
      {isPending ? sendingLabel : label}
    </Button>
  );
}
