import type { LucideIcon } from 'lucide-react';
import { TrendingDown, TrendingUp } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';

export interface KpiCardProps {
  label: string;
  /** Pre-formatted (currency/number/percent) — this component does not format values. */
  value: string;
  icon?: LucideIcon;
  /** Percentage change vs. the previous period; sign decides the tone. */
  delta?: number;
  deltaLabel?: string;
  className?: string;
}

export function KpiCard({ label, value, icon: Icon, delta, deltaLabel, className }: KpiCardProps) {
  const positive = typeof delta === 'number' && delta >= 0;

  return (
    <Card className={cn(className)}>
      <CardContent className="flex flex-col gap-2 pt-6">
        <div className="flex items-center justify-between">
          <p className="text-label text-(--color-text-muted)">{label}</p>
          {Icon ? (
            <span className="flex size-8 items-center justify-center rounded-(--radius-control) bg-(--color-muted)">
              <Icon className="size-4 text-(--color-text-muted)" aria-hidden="true" />
            </span>
          ) : null}
        </div>

        <p className="tabular-nums text-h3 text-(--color-text)">{value}</p>

        {typeof delta === 'number' ? (
          <div
            className={cn(
              'inline-flex w-fit items-center gap-1 text-caption font-medium',
              positive ? 'text-(--color-success)' : 'text-(--color-error)',
            )}
          >
            {positive ? (
              <TrendingUp className="size-3.5" aria-hidden="true" />
            ) : (
              <TrendingDown className="size-3.5" aria-hidden="true" />
            )}
            <span className="tabular-nums" dir="ltr">
              {positive ? '+' : ''}
              {delta.toFixed(1)}%
            </span>
            {deltaLabel ? <span className="text-(--color-text-muted)">{deltaLabel}</span> : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
