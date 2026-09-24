/**
 * Revenue per day, as inline SVG (P15).
 *
 * No charting library. The project's rule is no dependency without a
 * reason, and one bar chart is not a reason — a library here would ship
 * tens of kilobytes to draw rectangles, and would need its own work to
 * become RTL-aware, theme-aware and accessible, all of which is done below
 * in CSS variables the design system already defines.
 *
 * **Accessibility.** The SVG is `aria-hidden`, and the same numbers are
 * given as a real `<table>` beneath it, visually hidden. That is the
 * pattern that actually works: a screen reader user gets every value and a
 * structure to navigate, rather than one summary sentence, and axe has
 * nothing to complain about because there is no chart to describe. The
 * table is also what a keyboard user reaches — there is nothing
 * interactive in the drawing itself, so nothing that needs a focus stop.
 *
 * **Direction.** Bars are laid out left-to-right in both locales,
 * deliberately: this is a time axis, and time in a chart reads left to
 * right in Arabic too. Only the labels flip, which they do on their own.
 */

export interface RevenueChartDatum {
  date: string;
  /** Pre-formatted for the reader's locale — this component never formats. */
  dateLabel: string;
  revenueMinor: number;
  amountLabel: string;
  orderCount: number;
}

export interface RevenueChartLabels {
  caption: string;
  colDate: string;
  colAmount: string;
  colOrders: string;
  empty: string;
}

const VIEWBOX_WIDTH = 720;
const VIEWBOX_HEIGHT = 200;
const BASELINE = VIEWBOX_HEIGHT - 24;

export function RevenueChart({
  data,
  labels,
}: {
  data: RevenueChartDatum[];
  labels: RevenueChartLabels;
}) {
  if (data.length === 0) {
    return <p className="text-small text-(--color-text-muted)">{labels.empty}</p>;
  }

  const peak = Math.max(...data.map((day) => day.revenueMinor));
  const slot = VIEWBOX_WIDTH / data.length;
  // A visible gap between bars, but never so wide that a 90-day range draws
  // hairlines: at that density the gap collapses and the chart reads as an
  // area, which is the honest shape for that much data.
  const barWidth = Math.max(slot - Math.min(6, slot * 0.3), 1);

  // Three labels, whatever the range. A 90-day axis with ninety dates under
  // it is unreadable at any width, and three medium-format dates are as
  // many as fit across a card at 390px without forcing a scroll.
  const labelEvery = Math.max(1, Math.ceil(data.length / 3));
  const axisLabels = data.filter((_, index) => index % labelEvery === 0);

  return (
    <div className="flex flex-col gap-2">
      {/* No scroll container and no minimum width. `preserveAspectRatio`
          is `none`, so the drawing simply stretches to whatever width it is
          given and stays readable at 390px — whereas a `min-w` here would
          make this a scrollable region with nothing focusable inside it,
          which axe rightly rejects (`scrollable-region-focusable`) because a
          keyboard user could not scroll it. Exact values live in the table
          below regardless. */}
      <svg
        viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
        className="h-48 w-full"
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        <line
          x1={0}
          y1={BASELINE}
          x2={VIEWBOX_WIDTH}
          y2={BASELINE}
          stroke="var(--color-border)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
        {data.map((day, index) => {
          // `peak === 0` means an all-quiet range: every bar is zero and
          // dividing by it would produce NaN geometry rather than a flat
          // baseline.
          const height = peak === 0 ? 0 : (day.revenueMinor / peak) * (BASELINE - 8);
          return (
            <rect
              key={day.date}
              x={index * slot + (slot - barWidth) / 2}
              y={BASELINE - height}
              width={barWidth}
              height={height}
              rx={2}
              fill="var(--color-primary)"
            />
          );
        })}
      </svg>

      <div
        className="flex justify-between gap-2 text-caption whitespace-nowrap text-(--color-text-subtle)"
        dir="ltr"
      >
        {axisLabels.map((day) => (
          <span key={day.date}>{day.dateLabel}</span>
        ))}
      </div>

      {/*
        A plain `<table>`, not the design system's `Table`: that one wraps
        itself in an `overflow-x-auto` box, and inside a 1px-wide `sr-only`
        container that box becomes a scrollable region with nothing
        focusable in it — which is a genuine axe failure
        (`scrollable-region-focusable`), and a keyboard trap-shaped one at
        that. Nothing here is ever seen, so it needs no styling, and the
        markup a screen reader walks is identical.
      */}
      <table className="sr-only">
        <caption>{labels.caption}</caption>
        <thead>
          <tr>
            <th scope="col">{labels.colDate}</th>
            <th scope="col">{labels.colAmount}</th>
            <th scope="col">{labels.colOrders}</th>
          </tr>
        </thead>
        <tbody>
          {data.map((day) => (
            <tr key={day.date}>
              <th scope="row">{day.dateLabel}</th>
              <td>{day.amountLabel}</td>
              <td>{day.orderCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
