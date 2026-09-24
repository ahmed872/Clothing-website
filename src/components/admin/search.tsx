'use client';

import { Search as SearchIcon, X } from 'lucide-react';

import { cn } from '@/lib/utils';

export interface AdminSearchProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export function AdminSearch({
  value,
  onChange,
  placeholder = 'بحث…',
  className,
}: AdminSearchProps) {
  return (
    <div className={cn('relative', className)}>
      <SearchIcon
        className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-(--color-text-subtle)"
        aria-hidden="true"
      />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className={cn(
          'h-10 w-full rounded-(--radius-control) border border-(--color-border) bg-(--color-surface) ps-9 pe-9 text-sm',
          'text-(--color-text) placeholder:text-(--color-text-subtle) outline-none transition-colors duration-(--duration-fast)',
          'focus-visible:border-(--color-ring) focus-visible:ring-2 focus-visible:ring-(--color-ring)/25',
        )}
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="مسح البحث"
          className="absolute inset-y-0 end-3 my-auto flex size-4 items-center justify-center text-(--color-text-subtle) hover:text-(--color-text)"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
