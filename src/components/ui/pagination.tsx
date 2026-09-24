import { ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export interface PaginationProps {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  className?: string;
  labels?: { previous: string; next: string; page: (n: number) => string };
}

const DEFAULT_LABELS = {
  previous: 'السابق',
  next: 'التالي',
  page: (n: number) => `صفحة ${n}`,
};

/** Builds a compact page list: first, last, current ±1, with `…` gaps. */
function buildPageList(page: number, pageCount: number): (number | 'gap')[] {
  const pages = new Set<number>([1, pageCount, page, page - 1, page + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= pageCount).sort((a, b) => a - b);

  const result: (number | 'gap')[] = [];
  let previous = 0;
  for (const p of sorted) {
    if (previous && p - previous > 1) result.push('gap');
    result.push(p);
    previous = p;
  }
  return result;
}

export function Pagination({ page, pageCount, onPageChange, className, labels }: PaginationProps) {
  const t = labels ?? DEFAULT_LABELS;
  const items = buildPageList(page, pageCount);

  return (
    <nav aria-label="الصفحات" className={cn('flex items-center gap-1', className)}>
      <Button
        variant="outline"
        size="icon"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        aria-label={t.previous}
      >
        <ChevronLeft className="rtl:rotate-180" aria-hidden="true" />
      </Button>

      <ul className="flex items-center gap-1">
        {items.map((item, index) =>
          item === 'gap' ? (
            <li
              key={`gap-${index}`}
              className="flex size-10 items-center justify-center text-(--color-text-subtle)"
            >
              <MoreHorizontal className="size-4" aria-hidden="true" />
            </li>
          ) : (
            <li key={item}>
              <Button
                variant={item === page ? 'primary' : 'ghost'}
                size="icon"
                aria-current={item === page ? 'page' : undefined}
                aria-label={t.page(item)}
                onClick={() => onPageChange(item)}
                className="tabular-nums"
              >
                {item}
              </Button>
            </li>
          ),
        )}
      </ul>

      <Button
        variant="outline"
        size="icon"
        disabled={page >= pageCount}
        onClick={() => onPageChange(page + 1)}
        aria-label={t.next}
      >
        <ChevronRight className="rtl:rotate-180" aria-hidden="true" />
      </Button>
    </nav>
  );
}
