'use client';

import * as React from 'react';
import Image from 'next/image';
import { Sparkles } from 'lucide-react';

import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import type { getDictionary } from '@/lib/i18n/dictionary';
import type { TryOnAvailability } from '@/lib/try-on/try-on';
import {
  cancelTryOnAction,
  retryTryOnAction,
  startTryOnAction,
  type TryOnActionError,
  type TryOnActionResult,
} from '@/lib/try-on/try-on-actions';
import type { TryOnJobView } from '@/modules/tryon';

type Labels = ReturnType<typeof getDictionary>['tryOn'];

/** How often the page asks for an unfinished job's progress. The server
 * asks the provider at most this often too, however many tabs poll. */
const POLL_MS = 2_000;

const ACTIVE = new Set(['PENDING', 'PROCESSING']);

/**
 * Optional AI try-on, under the fitting room (clothing P05).
 *
 * Off by default, and the page says so plainly — the personalized fitting
 * room above works either way. When on, nothing is sent until the customer
 * ticks the consent box for this request; the server then builds the
 * request from the catalog and their saved profile. A mock provider is
 * labelled as one before, during and after a job, and its outcome is never
 * presented as an AI image — it has none.
 */
export function TryOnPanel({
  availability,
  slug,
  variantId,
  initialJob,
  t,
}: {
  availability: TryOnAvailability;
  slug: string;
  /** The variant the fitting room has selected; null when that combination
   * is not sold. */
  variantId: string | null;
  initialJob: TryOnJobView | null;
  t: Labels;
}) {
  const consentId = React.useId();
  const headingId = React.useId();
  const [consent, setConsent] = React.useState(false);
  const [job, setJob] = React.useState(initialJob);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<TryOnActionError | null>(null);
  // One key per start: a double click or a retried request reuses it, and
  // the server answers with the same job.
  const keyRef = React.useRef<string | null>(null);

  const active = job !== null && ACTIVE.has(job.status);

  React.useEffect(() => {
    if (!job || !ACTIVE.has(job.status)) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/try-on/jobs/${job.id}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) {
          setError(response.status === 401 ? 'session_expired' : 'generic');
          return;
        }
        const body = (await response.json()) as { job: TryOnJobView };
        setJob(body.job);
      } catch {
        // Aborted by a newer state, or offline: the next render polls again.
      }
    }, POLL_MS);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [job]);

  async function run(action: () => Promise<TryOnActionResult>, onDone?: () => void) {
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      if (result.ok) {
        setJob(result.job);
        keyRef.current = null;
        onDone?.();
      } else {
        setError(result.error);
      }
    } catch {
      setError('generic');
    } finally {
      setBusy(false);
    }
  }

  function start() {
    if (!variantId || !consent) return;
    keyRef.current ??= crypto.randomUUID();
    const idempotencyKey = keyRef.current;
    // Consent covers this request only; the next one asks again.
    void run(
      () => startTryOnAction({ slug, variantId, idempotencyKey, consent: true }),
      () => setConsent(false),
    );
  }

  if (!availability.enabled) {
    return (
      <section
        aria-labelledby={headingId}
        className="flex flex-col gap-2 rounded-(--radius-surface) border border-(--color-border) p-4"
        data-testid="try-on-unavailable"
      >
        <h2 id={headingId} className="text-h6 text-(--color-text)">
          {t.title}
        </h2>
        <p className="text-small text-(--color-text-muted)">{t.unavailable}</p>
      </section>
    );
  }

  const status = job ? t.status[job.status] : null;
  const showResult = job?.status === 'COMPLETED';

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded-(--radius-surface) border border-(--color-border) p-4"
      data-testid="try-on-panel"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 id={headingId} className="text-h6 text-(--color-text)">
          {t.title}
        </h2>
        {availability.isMock ? (
          <Badge variant="warning" data-testid="try-on-mock-badge">
            {t.mockBadge}
          </Badge>
        ) : null}
      </div>
      <p className="text-small text-(--color-text-muted)">{t.description}</p>
      {availability.isMock ? (
        <p className="text-small text-(--color-text-muted)" data-testid="try-on-mock-notice">
          {t.mockNotice}
        </p>
      ) : null}

      {!active ? (
        <>
          <div className="flex items-start gap-2">
            <Checkbox
              id={consentId}
              checked={consent}
              onCheckedChange={(value) => setConsent(value === true)}
              className="mt-0.5"
            />
            <label htmlFor={consentId} className="text-small text-(--color-text)">
              {t.consent}
            </label>
          </div>
          <div>
            <Button
              type="button"
              className="gap-2"
              disabled={!consent || !variantId || busy}
              onClick={start}
            >
              <Sparkles aria-hidden="true" />
              {busy ? t.starting : t.start}
            </Button>
          </div>
          {!variantId ? (
            <p className="text-small text-(--color-text-muted)">{t.noVariant}</p>
          ) : null}
        </>
      ) : null}

      <div
        aria-live="polite"
        className="flex flex-col gap-2"
        data-testid="try-on-status"
        data-job-id={job?.id}
      >
        {status ? (
          <p className="text-small text-(--color-text)" data-status={job?.status}>
            {status}
          </p>
        ) : null}
        {job?.status === 'FAILED' && job.errorCode ? (
          <p className="text-small text-(--color-text-muted)">
            {t.errors[job.errorCode as keyof Labels['errors']] ?? t.errors.provider_failed}
          </p>
        ) : null}
        {showResult && job.resultUrl ? (
          <figure className="flex flex-col gap-2">
            <Image
              src={job.resultUrl}
              alt={t.resultAlt}
              width={512}
              height={683}
              unoptimized
              className="h-auto w-full max-w-sm rounded-(--radius-surface) border border-(--color-border)"
            />
            <figcaption className="text-caption text-(--color-text-muted)">
              {job.isMock ? t.mockResultCaption : t.resultCaption}
            </figcaption>
          </figure>
        ) : null}
        {showResult && !job.resultUrl && job.isMock ? (
          <p className="text-small text-(--color-text-muted)" data-testid="try-on-mock-result">
            {t.mockCompleted}
          </p>
        ) : null}
      </div>

      {error ? <Alert variant="error">{t.actionErrors[error]}</Alert> : null}

      <div className="flex flex-wrap gap-2">
        {job?.canCancel ? (
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => void run(() => cancelTryOnAction({ jobId: job.id }))}
          >
            {t.cancel}
          </Button>
        ) : null}
        {job?.canRetry ? (
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => void run(() => retryTryOnAction({ jobId: job.id, slug }))}
          >
            {t.retry}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
