'use client';

import { useTransition } from 'react';
import { ChevronDown, LogOut } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { signOutAction } from '@/lib/admin/actions';

export interface UserMenuProps {
  name: string | null;
  email: string;
  roleLabel: string;
  labels: { userMenu: string; signOut: string; signingOut: string };
}

function initialsFor(name: string | null, email: string): string {
  const source = name?.trim() || email;
  const parts = source.split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const second = parts.length > 1 ? (parts[1]?.[0] ?? '') : '';
  return (first + second).toUpperCase() || '?';
}

export function UserMenu({ name, email, roleLabel, labels }: UserMenuProps) {
  const [isPending, startTransition] = useTransition();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="h-10 gap-2 ps-1.5 pe-2.5"
          aria-label={labels.userMenu}
        >
          <span
            aria-hidden="true"
            className="flex size-7 shrink-0 items-center justify-center rounded-(--radius-full) bg-(--color-primary) text-xs font-semibold text-(--color-primary-foreground)"
          >
            {initialsFor(name, email)}
          </span>
          <span className="hidden max-w-32 truncate text-sm font-medium text-(--color-text) sm:inline">
            {name?.trim() || email}
          </span>
          <ChevronDown className="size-3.5 text-(--color-text-muted)" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="flex flex-col gap-1 px-2 py-1.5">
          <span className="truncate text-sm font-medium text-(--color-text)">
            {name?.trim() || email}
          </span>
          <span className="truncate text-xs text-(--color-text-muted)">{email}</span>
          <Badge variant="brand" className="mt-1 w-fit">
            {roleLabel}
          </Badge>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          disabled={isPending}
          onSelect={(event) => {
            event.preventDefault();
            startTransition(() => {
              void signOutAction();
            });
          }}
        >
          <LogOut className="size-4" aria-hidden="true" />
          {isPending ? labels.signingOut : labels.signOut}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
