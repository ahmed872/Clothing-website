import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { LayoutTemplate, Plus } from 'lucide-react';

import { getSectionHeadline, listHomepageSections } from '@/modules/content';
import { DEFAULT_LOCALE, LOCALE_COOKIE_NAME, isLocale } from '@/lib/i18n/locales';
import { getAdminDictionary } from '@/lib/i18n/admin-dictionary';
import { requireAdminPermission } from '@/lib/admin/require-admin';
import { AdminBreadcrumbs } from '@/components/admin/admin-breadcrumbs';
import { PageHeader } from '@/components/admin/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { HomepageSectionsTable, type SectionRow } from '@/components/admin/homepage-sections-table';

export const metadata: Metadata = { title: 'Content' };

/**
 * The homepage's own screen (P15).
 *
 * This is the answer to "I added products and the store still says no
 * content has been published": `/[locale]/page.tsx` renders
 * `HomepageSection` rows and nothing else, and until this screen existed
 * those rows could only be created by `pnpm db:seed-storefront-demo` — a
 * development script, so a real deployment's homepage was empty by
 * construction. The empty state below says exactly that, and the button
 * next to it is the fix.
 */
export default async function AdminContentPage() {
  await requireAdminPermission('content.manage');

  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE_NAME)?.value;
  const locale = cookieLocale && isLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE;
  const t = getAdminDictionary(locale);

  const sections = await listHomepageSections();
  const rows: SectionRow[] = sections.map((section) => {
    const headline = getSectionHeadline(section.config);
    return {
      id: section.id,
      type: section.type,
      typeLabel: t.content.types[section.type],
      titleAr: headline.ar,
      titleEn: headline.en,
      enabled: section.enabled,
      hasDraft: section.draftConfig !== null,
    };
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t.content.title}
        description={t.content.description}
        breadcrumb={
          <AdminBreadcrumbs
            dashboardLabel={t.shell.dashboard}
            trail={[{ label: t.content.title }]}
          />
        }
        actions={
          <>
            <Button asChild variant="outline">
              <Link href={`/${locale}`} target="_blank" rel="noreferrer">
                {t.content.liveHomepage}
              </Link>
            </Button>
            <Button asChild>
              <Link href="/admin/content/new">
                <Plus className="size-4" aria-hidden="true" />
                {t.content.newSection}
              </Link>
            </Button>
          </>
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={LayoutTemplate}
          title={t.content.emptyTitle}
          description={t.content.emptyDescription}
          action={
            <Button asChild>
              <Link href="/admin/content/new">
                <Plus className="size-4" aria-hidden="true" />
                {t.content.addSection}
              </Link>
            </Button>
          }
        />
      ) : (
        <HomepageSectionsTable
          rows={rows}
          locale={locale}
          labels={{
            colSection: t.content.colSection,
            colType: t.content.colType,
            colState: t.content.colState,
            untitled: t.content.untitled,
            stateLive: t.content.stateLive,
            stateHidden: t.content.stateHidden,
            stateDraft: t.content.stateDraft,
            moveUp: t.content.moveUp,
            moveDown: t.content.moveDown,
            orderSaved: t.content.orderSaved,
            show: t.content.show,
            hide: t.content.hide,
            shown: t.content.shown,
            hidden: t.content.hidden,
            edit: t.common.edit,
            publishDraft: t.content.publishDraft,
            discardDraft: t.content.discardDraft,
            draftPublished: t.content.draftPublished,
            draftDiscarded: t.content.draftDiscarded,
            delete: t.common.delete,
            deleted: t.content.deleted,
            confirmDeleteTitle: t.content.confirmDeleteTitle,
            confirmDeleteDescription: t.content.confirmDeleteDescription,
            confirmDiscardTitle: t.content.confirmDiscardTitle,
            confirmDiscardDescription: t.content.confirmDiscardDescription,
            confirm: t.common.confirm,
            cancel: t.common.cancel,
          }}
        />
      )}
    </div>
  );
}
