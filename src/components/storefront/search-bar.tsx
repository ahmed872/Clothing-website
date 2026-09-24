'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import type { Locale } from '@/lib/i18n/locales';

export interface SearchBarProps {
  locale: Locale;
  placeholder: string;
  submitLabel: string;
  className?: string;
}

export function SearchBar({ locale, placeholder, submitLabel, className }: SearchBarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [value, setValue] = React.useState(searchParams.get('q') ?? '');

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = value.trim();
    const url = trimmed
      ? `/${locale}/search?q=${encodeURIComponent(trimmed)}`
      : `/${locale}/search`;
    router.push(url);
  };

  return (
    <form role="search" onSubmit={handleSubmit} className={cn('relative flex w-full', className)}>
      <Search
        className="pointer-events-none absolute top-1/2 start-3 size-4 -translate-y-1/2 text-(--color-text-muted)"
        aria-hidden="true"
      />
      <Input
        type="search"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={placeholder}
        aria-label={submitLabel}
        className="ps-9"
      />
      <Button type="submit" className="sr-only">
        {submitLabel}
      </Button>
    </form>
  );
}
