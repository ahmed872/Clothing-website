import type { Locale } from '@/modules/core/money';
import { Badge } from '@/components/ui/badge';

export type StockStatus = 'in-stock' | 'low-stock' | 'out-of-stock';

export interface StockBadgeProps {
  status: StockStatus;
  /** Shown for `low-stock` instead of the default label, e.g. "Only 3 left". */
  quantityLabel?: string;
  locale?: Locale;
  className?: string;
}

const LABELS: Record<Locale, Record<StockStatus, string>> = {
  ar: { 'in-stock': 'متوفر', 'low-stock': 'كمية محدودة', 'out-of-stock': 'غير متوفر' },
  en: { 'in-stock': 'In stock', 'low-stock': 'Limited stock', 'out-of-stock': 'Out of stock' },
};

const VARIANT: Record<StockStatus, 'success' | 'warning' | 'error'> = {
  'in-stock': 'success',
  'low-stock': 'warning',
  'out-of-stock': 'error',
};

export function StockBadge({ status, quantityLabel, locale = 'ar', className }: StockBadgeProps) {
  return (
    <Badge variant={VARIANT[status]} className={className}>
      {status === 'low-stock' && quantityLabel ? quantityLabel : LABELS[locale][status]}
    </Badge>
  );
}
