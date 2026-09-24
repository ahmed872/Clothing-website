import { Badge } from '@/components/ui/badge';

export interface DiscountBadgeProps {
  percentOff: number;
  className?: string;
}

/** `-20%`, always Latin numerals. Renders nothing for a non-positive discount. */
export function DiscountBadge({ percentOff, className }: DiscountBadgeProps) {
  if (percentOff <= 0) return null;

  return (
    <Badge variant="error" className={className}>
      <span className="tabular-nums" dir="ltr">
        -{Math.round(percentOff)}%
      </span>
    </Badge>
  );
}
