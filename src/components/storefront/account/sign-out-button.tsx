'use client';

import { useTransition } from 'react';
import { LogOut } from 'lucide-react';

import type { Locale } from '@/lib/i18n/locales';
import { customerSignOutAction } from '@/lib/customers/customer-actions';
import { Button } from '@/components/ui/button';

export function SignOutButton({
  locale,
  label,
  signingOutLabel,
}: {
  locale: Locale;
  label: string;
  signingOutLabel: string;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={isPending}
      onClick={() => {
        startTransition(() => {
          void customerSignOutAction(locale);
        });
      }}
    >
      <LogOut className="size-4" aria-hidden="true" />
      {isPending ? signingOutLabel : label}
    </Button>
  );
}
