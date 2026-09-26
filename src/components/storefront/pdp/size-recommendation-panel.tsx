'use client';

import * as React from 'react';
import Link from 'next/link';
import { AlertCircle, Check, Info, Ruler, Sparkles } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { ChoiceGroup } from '@/components/storefront/body-profile/choice-group';
import { SizeChartTable } from '@/components/commerce/size-chart-table';
import type { SizeRecommendationView } from '@/lib/sizing/size-recommendation-view';
import type { getDictionary } from '@/lib/i18n/dictionary';
import type { Locale } from '@/lib/i18n/locales';
import type { StorefrontSizeChart } from '@/modules/sizing';
import type { ProfileMeasurementKey, SizeRecommendationReason } from '@/modules/sizing';

type SizingLabels = ReturnType<typeof getDictionary>['sizing'];

const FIT_ORDER = ['SLIM', 'REGULAR', 'RELAXED'] as const;

export interface SizeRecommendationPanelProps {
  productId: string;
  locale: Locale;
  labels: SizingLabels;
  chart: StorefrontSizeChart;
  /** Size id → the size's name in the page's language. */
  sizeName: (sizeId: string) => string;
  /** The size currently chosen in the variant selector, if any. */
  selectedSizeId: string | undefined;
  onSelectSize: (sizeId: string) => void;
}

/**
 * "Your recommended size" on the product page (clothing P02).
 *
 * The page around it is cached for everyone, so the recommendation is
 * fetched after load, for whoever is signed in — and re-fetched when they
 * try another fit. Everything shown comes from the server's rule-based
 * engine as sizes and reason codes; this component only puts them into
 * words, and never holds or shows a measurement. The size chart is public
 * product data and is always available beside it, so the recommendation is
 * never the only way to choose.
 */
export function SizeRecommendationPanel({
  productId,
  locale,
  labels,
  chart,
  sizeName,
  selectedSizeId,
  onSelectSize,
}: SizeRecommendationPanelProps) {
  const [view, setView] = React.useState<SizeRecommendationView | null>(null);
  const [fit, setFit] = React.useState<string | undefined>(undefined);
  const [pending, setPending] = React.useState(false);
  const fitGroupId = React.useId();
  const direction = locale === 'ar' ? 'rtl' : 'ltr';
  const request = React.useRef<AbortController | null>(null);

  // A GET, not a Server Action: actions are dispatched one at a time in the
  // same queue as navigations, so reading through one on page load would
  // hold up the shopper's next click. Each new request aborts the last, so
  // switching fits quickly can never show an older answer.
  const load = React.useCallback(
    (fitPreference?: string) => {
      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      const params = new URLSearchParams({ productId });
      if (fitPreference) params.set('fit', fitPreference);
      fetch(`/api/size-recommendation?${params}`, {
        signal: controller.signal,
        cache: 'no-store',
        credentials: 'same-origin',
      })
        .then((response) =>
          response.ok
            ? (response.json() as Promise<SizeRecommendationView>)
            : ({ status: 'error' } as const),
        )
        .then((next) => {
          if (controller.signal.aborted) return;
          setView(next);
          setPending(false);
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setView({ status: 'error' });
          setPending(false);
        });
    },
    [productId],
  );

  React.useEffect(() => {
    load();
    return () => request.current?.abort();
  }, [load]);

  const profileHref = `/${locale}/account/body-profile`;
  const names = (keys: readonly ProfileMeasurementKey[]) =>
    keys.map((key) => labels.profileMeasurementNames[key]).join(labels.listJoin);

  const sizeGuide = (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant="link" className="h-auto gap-1.5 self-start px-0">
          <Ruler aria-hidden="true" />
          {labels.sizeGuide.open}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{labels.sizeGuide.title}</DialogTitle>
          <DialogDescription>{labels.sizeGuide.description}</DialogDescription>
        </DialogHeader>
        <SizeChartTable
          caption={labels.sizeGuide.title}
          locale={locale}
          columns={chart.columns}
          rows={chart.rows.map((row) => ({
            sizeId: row.sizeId,
            label: sizeName(row.sizeId),
            measurements: row.measurements,
          }))}
          labels={{
            size: labels.sizeGuide.size,
            unit: labels.sizeGuide.unit,
            measurements: labels.measurementNames,
          }}
          highlightSizeId={view?.status === 'recommended' ? view.recommendedSizeId : undefined}
          highlightLabel={labels.chartRecommended}
        />
      </DialogContent>
    </Dialog>
  );

  const fitChoice =
    view && (view.status === 'recommended' || view.status === 'no_matching_size') ? (
      <ChoiceGroup
        id={fitGroupId}
        label={labels.fitLabel}
        value={fit ?? view.fitPreference}
        onChange={(value) => {
          setFit(value);
          setPending(true);
          load(value);
        }}
        options={FIT_ORDER.map((value) => ({ value, label: labels.fitOptions[value] }))}
        direction={direction}
      />
    ) : null;

  let body: React.ReactNode;
  if (!view) {
    body = <p className="text-small text-(--color-text-muted)">{labels.loading}</p>;
  } else if (view.status === 'signed_out' || view.status === 'no_profile') {
    const copy = view.status === 'signed_out' ? labels.signedOut : labels.noProfile;
    const href =
      view.status === 'signed_out'
        ? `/${locale}/account/login?next=${encodeURIComponent(profileHref)}`
        : profileHref;
    body = (
      <div className="flex flex-col gap-2" data-testid="size-recommendation-cta">
        <p className="text-sm font-medium text-(--color-text)">{copy.title}</p>
        <p className="text-small text-(--color-text-muted)">{copy.body}</p>
        <Button asChild variant="outline" size="sm" className="self-start">
          <Link href={href}>
            <Sparkles aria-hidden="true" />
            {copy.cta}
          </Link>
        </Button>
      </div>
    );
  } else if (view.status === 'no_sizing') {
    body = null;
  } else if (view.status === 'error') {
    body = <p className="text-small text-(--color-text-muted)">{labels.error}</p>;
  } else if (view.status === 'insufficient_data') {
    body = (
      <div className="flex flex-col gap-2" data-testid="size-recommendation-insufficient">
        <p className="flex items-start gap-2 text-small text-(--color-text)">
          <Info className="mt-0.5 size-4 shrink-0 text-(--color-info)" aria-hidden="true" />
          {labels.insufficient
            .replace('{measurements}', names(view.missing))
            .replace('{item}', labels.items[view.garmentType])}
        </p>
        <Button asChild variant="outline" size="sm" className="self-start">
          <Link href={profileHref}>{labels.updateProfile}</Link>
        </Button>
      </div>
    );
  } else if (view.status === 'no_matching_size') {
    body = (
      <div className="flex flex-col gap-3" data-testid="size-recommendation-no-match">
        <p className="flex items-start gap-2 text-small text-(--color-text)">
          <AlertCircle
            className="mt-0.5 size-4 shrink-0 text-(--color-warning)"
            aria-hidden="true"
          />
          <span>
            {labels.noMatch[view.direction]} {labels.noMatchHelp}
          </span>
        </p>
        {fitChoice}
      </div>
    );
  } else {
    const recommended = sizeName(view.recommendedSizeId);
    const isSelected = selectedSizeId === view.recommendedSizeId;
    body = (
      <div className="flex flex-col gap-3" data-testid="size-recommendation">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-body font-semibold text-(--color-text)" data-testid="recommended-size">
            {labels.recommended.replace('{size}', recommended)}
          </p>
          <Badge
            variant={
              view.confidence === 'HIGH'
                ? 'success'
                : view.confidence === 'MEDIUM'
                  ? 'info'
                  : 'warning'
            }
            data-confidence={view.confidence}
          >
            {labels.confidence[view.confidence]}
          </Badge>
        </div>
        <p className="text-caption text-(--color-text-muted)">
          {labels.confidenceHelp[view.confidence]}
        </p>

        {isSelected ? (
          <p className="flex items-center gap-1.5 text-small text-(--color-success)">
            <Check className="size-4" aria-hidden="true" />
            {labels.selectedSize.replace('{size}', recommended)}
          </p>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="self-start"
            onClick={() => onSelectSize(view.recommendedSizeId)}
          >
            {labels.selectSize.replace('{size}', recommended)}
          </Button>
        )}

        <div className="flex flex-col gap-1.5">
          <p className="text-sm font-medium text-(--color-text)">{labels.why}</p>
          <ul className="flex flex-col gap-1" data-testid="size-recommendation-reasons">
            {view.reasons.map((reason, index) => (
              <ReasonItem
                key={index}
                reason={reason}
                labels={labels}
                sizeName={sizeName}
                names={names}
              />
            ))}
          </ul>
        </div>

        {view.alternatives.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-medium text-(--color-text)">{labels.alternatives}</p>
            <ul className="flex flex-col gap-1" data-testid="size-recommendation-alternatives">
              {view.alternatives.map((alternative) => (
                <li key={alternative.sizeId}>
                  <button
                    type="button"
                    className="text-small text-(--color-text) underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-(--color-ring)/25 outline-none rounded-(--radius-sm)"
                    onClick={() => onSelectSize(alternative.sizeId)}
                  >
                    {labels.alternative[alternative.direction].replace(
                      '{size}',
                      sizeName(alternative.sizeId),
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {fitChoice}

        <details className="text-caption text-(--color-text-muted)">
          <summary className="cursor-pointer text-(--color-text)">{labels.howItWorks}</summary>
          <p className="mt-1">{labels.howItWorksBody}</p>
          <p className="mt-1">{labels.privacy}</p>
        </details>
      </div>
    );
  }

  return (
    <section
      aria-labelledby={`${fitGroupId}-title`}
      aria-busy={pending || undefined}
      className="flex flex-col gap-3 rounded-(--radius-surface) border border-(--color-border) bg-(--color-surface) p-4"
      data-testid="size-recommendation-panel"
    >
      <h2
        id={`${fitGroupId}-title`}
        className="flex items-center gap-2 text-sm font-semibold text-(--color-text)"
      >
        <Ruler className="size-4" aria-hidden="true" />
        {labels.title}
      </h2>
      <div aria-live="polite">{body}</div>
      {sizeGuide}
    </section>
  );
}

function ReasonItem({
  reason,
  labels,
  sizeName,
  names,
}: {
  reason: SizeRecommendationReason;
  labels: SizingLabels;
  sizeName: (sizeId: string) => string;
  names: (keys: readonly ProfileMeasurementKey[]) => string;
}) {
  let text: string;
  let good = true;
  switch (reason.code) {
    case 'measurement':
      text = labels.reasonMeasurement
        .replace('{measurement}', labels.measurementNames[reason.measurement])
        .replace('{fit}', labels.fits[reason.fit]);
      good = reason.fit === 'fits';
      break;
    case 'fit_preference':
      text = labels.reasonFit[reason.fitPreference];
      break;
    case 'length_from_height':
      text = labels.reasonLengthFromHeight;
      break;
    case 'between_sizes':
      text = labels.reasonBetweenSizes.replace('{size}', sizeName(reason.otherSizeId));
      good = false;
      break;
    case 'limited_measurements':
      text = labels.reasonLimited.replace('{measurements}', names(reason.missing));
      good = false;
      break;
  }
  // An icon *and* the words carry the meaning — never colour alone.
  return (
    <li className="flex items-start gap-2 text-small text-(--color-text)" data-reason={reason.code}>
      {good ? (
        <Check className="mt-0.5 size-4 shrink-0 text-(--color-success)" aria-hidden="true" />
      ) : (
        <Info className="mt-0.5 size-4 shrink-0 text-(--color-info)" aria-hidden="true" />
      )}
      <span>{text}</span>
    </li>
  );
}
