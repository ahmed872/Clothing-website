import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import type { GarmentMeasurementKey } from '@/modules/sizing/garment-types';

export interface SizeChartTableRow {
  sizeId: string;
  label: string;
  measurements: Partial<Record<GarmentMeasurementKey, number>>;
}

export interface SizeChartTableProps {
  caption: string;
  columns: readonly GarmentMeasurementKey[];
  rows: readonly SizeChartTableRow[];
  labels: {
    size: string;
    unit: string;
    measurements: Record<GarmentMeasurementKey, string>;
  };
  locale: 'ar' | 'en';
  /** The size to mark as the customer's recommendation, if any. */
  highlightSizeId?: string;
  highlightLabel?: string;
}

/**
 * A size chart as a real table: a caption, a header per measurement with
 * its unit, and one row per size — the same component for the admin's
 * preview and the product page's size guide, so what the admin previews is
 * what the shopper reads. Numbers are centimetres whatever the language,
 * formatted in the page's locale digits.
 */
export function SizeChartTable({
  caption,
  columns,
  rows,
  labels,
  locale,
  highlightSizeId,
  highlightLabel,
}: SizeChartTableProps) {
  const format = new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en-US', {
    maximumFractionDigits: 1,
  });
  return (
    <Table>
      <caption className="sr-only">{caption}</caption>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">{labels.size}</TableHead>
          {columns.map((column) => (
            <TableHead key={column} scope="col" className="text-end whitespace-nowrap">
              {labels.measurements[column]}{' '}
              <span className="font-normal text-(--color-text-muted)">({labels.unit})</span>
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const highlighted = row.sizeId === highlightSizeId;
          return (
            <TableRow
              key={row.sizeId}
              className={cn(highlighted && 'bg-(--color-primary)/8')}
              data-size-row={row.label}
            >
              <TableHead
                scope="row"
                className="text-sm font-medium tracking-normal normal-case text-(--color-text)"
              >
                {row.label}
                {highlighted && highlightLabel ? (
                  <span className="ms-2 text-caption font-normal text-(--color-primary)">
                    {highlightLabel}
                  </span>
                ) : null}
              </TableHead>
              {columns.map((column) => {
                const value = row.measurements[column];
                return (
                  <TableCell key={column} className="text-end tabular-nums">
                    {typeof value === 'number' ? format.format(value) : '—'}
                  </TableCell>
                );
              })}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
