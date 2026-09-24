'use client';

import { useId } from 'react';
import { Check } from 'lucide-react';

import type { CompletionSection, ProfileCompletion } from '@/modules/body-profile';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import type { BodyProfileLabels } from './labels';

const SECTIONS: readonly CompletionSection[] = ['basic', 'measurements', 'appearance'];

/**
 * The deterministic completeness score, said plainly: the percentage, the
 * one most useful thing to add next, and where each section stands. A
 * complete section shows a check mark *and* the word, never colour alone.
 */
export function CompletionCard({
  completion,
  labels,
  sectionTitles,
}: {
  completion: ProfileCompletion;
  labels: BodyProfileLabels['completion'];
  sectionTitles: Record<CompletionSection, string>;
}) {
  const titleId = useId();
  const summary =
    completion.percent === 100
      ? labels.complete
      : labels.percent.replace('{percent}', String(completion.percent));

  return (
    <Card data-testid="completion-card">
      <CardHeader>
        <CardTitle id={titleId}>{labels.title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-small font-medium text-(--color-text)" data-testid="completion-percent">
          {summary}
        </p>
        <div
          role="progressbar"
          aria-labelledby={titleId}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={completion.percent}
          aria-valuetext={`${completion.percent}%`}
          className="h-2 w-full overflow-hidden rounded-(--radius-full) bg-(--color-surface-raised)"
        >
          <div
            className="h-full rounded-(--radius-full) bg-(--color-primary) transition-[width] duration-(--duration-base)"
            style={{ width: `${completion.percent}%` }}
          />
        </div>
        {completion.nextStep ? (
          <p className="text-small text-(--color-text-muted)" data-testid="completion-next">
            {labels.next[completion.nextStep]}
          </p>
        ) : null}
        <ul className="flex flex-col gap-1.5 text-small">
          {SECTIONS.map((section) => {
            const state = completion.sections[section];
            return (
              <li key={section} className="flex items-center justify-between gap-2">
                <span className="text-(--color-text)">{sectionTitles[section]}</span>
                {state.complete ? (
                  <span className="inline-flex items-center gap-1 text-(--color-success)">
                    <Check aria-hidden="true" className="size-4" />
                    {labels.sectionDone}
                  </span>
                ) : (
                  <span className="text-(--color-text-muted)">
                    {labels.sectionProgress
                      .replace('{done}', String(state.done))
                      .replace('{total}', String(state.total))}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
