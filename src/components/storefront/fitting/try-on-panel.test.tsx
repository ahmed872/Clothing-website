import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { getDictionary } from '@/lib/i18n/dictionary';
import type { TryOnJobView } from '@/modules/tryon';

import { TryOnPanel } from './try-on-panel';

/**
 * What the try-on panel says in each state — above all, that "off" is said
 * plainly and that a mock is never passed off as AI.
 */

const en = getDictionary('en').tryOn;
const ar = getDictionary('ar').tryOn;

function job(overrides: Partial<TryOnJobView>): TryOnJobView {
  return {
    id: '6f1c2d3e-0000-4000-8000-000000000001',
    productId: 'p',
    variantId: 'v',
    status: 'PROCESSING',
    isMock: true,
    resultUrl: null,
    errorCode: null,
    canCancel: false,
    canRetry: false,
    createdAt: '2026-09-26T10:00:00.000Z',
    expiresAt: '2026-09-27T10:00:00.000Z',
    ...overrides,
  };
}

const render = (props: Partial<React.ComponentProps<typeof TryOnPanel>> = {}) =>
  renderToStaticMarkup(
    <TryOnPanel
      availability={{ enabled: true, isMock: true }}
      slug="tee"
      variantId="v"
      initialJob={null}
      t={en}
      {...props}
    />,
  );

describe('TryOnPanel', () => {
  it('says plainly when AI try-on is off, in both languages, and offers nothing to press', () => {
    const off = render({ availability: { enabled: false } });
    expect(off).toContain(
      'AI Try-On is currently unavailable. You can still use the personalized fitting room.',
    );
    expect(off).not.toContain('<button');
    expect(render({ availability: { enabled: false }, t: ar })).toContain(
      'التجربة بالذكاء الاصطناعي غير متاحة حاليًا',
    );
  });

  it('labels the mock provider before anything is started', () => {
    const markup = render();
    expect(markup).toContain(en.mockBadge);
    expect(markup).toContain(en.mockNotice);
    expect(markup).toContain(en.consent);
  });

  it('a finished mock job says no AI image was generated, and shows none', () => {
    const markup = render({ initialJob: job({ status: 'COMPLETED' }) });
    expect(markup).toContain(en.mockCompleted);
    expect(markup).not.toContain('<img');
  });

  it('a real result is shown with its alt text and an AI caption', () => {
    const markup = render({
      availability: { enabled: true, isMock: false },
      initialJob: job({
        status: 'COMPLETED',
        isMock: false,
        resultUrl: 'https://results.example-cdn.test/a.png',
      }),
    });
    expect(markup).toContain(`alt="${en.resultAlt}"`);
    expect(markup).toContain(en.resultCaption);
    expect(markup).not.toContain(en.mockBadge);
  });

  it('explains a refused result without showing it', () => {
    const markup = render({
      initialJob: job({ status: 'FAILED', errorCode: 'unsafe_result_url', canRetry: true }),
    });
    expect(markup).toContain(en.errors.unsafe_result_url);
    expect(markup).toContain(en.retry);
    expect(markup).not.toContain('<img');
  });

  it('a running job offers cancel, not a second start', () => {
    const markup = render({ initialJob: job({ status: 'PROCESSING', canCancel: true }) });
    expect(markup).toContain(en.status.PROCESSING);
    expect(markup).toContain(en.cancel);
    expect(markup).not.toContain(en.start);
  });
});
