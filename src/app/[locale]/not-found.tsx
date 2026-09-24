import { FileQuestion } from 'lucide-react';

import { EmptyState } from '@/components/ui/empty-state';

/**
 * The shared 404 for everything under `/[locale]/*` — a category, a
 * product, or any other unmatched storefront route calling `notFound()`
 * renders this. Locale-agnostic on purpose: by the time a request reaches
 * here, `[locale]/layout.tsx` has already failed to resolve a real segment
 * (Next renders the nearest `not-found.tsx` outside the failed layout's own
 * render, so it can't rely on that layout's locale-derived context either).
 */
export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-2xl items-center justify-center px-4 py-16">
      <EmptyState
        icon={FileQuestion}
        title="الصفحة غير موجودة — Page not found"
        description="الرابط قد يكون غير صحيح أو تم نقل المحتوى. — The link may be broken, or the content has moved."
      />
    </div>
  );
}
