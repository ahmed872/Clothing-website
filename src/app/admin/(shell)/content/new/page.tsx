import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import type { HomepageSectionType } from '@generated/prisma';

import { sectionConfigSchemas } from '@/modules/content';
import { DEFAULT_LOCALE, LOCALE_COOKIE_NAME, isLocale } from '@/lib/i18n/locales';
import { getAdminDictionary } from '@/lib/i18n/admin-dictionary';
import { requireAdminPermission } from '@/lib/admin/require-admin';
import { buildSectionFormLabels } from '@/lib/admin/content-form-labels';
import { listCategoriesForContentAction } from '@/lib/admin/content-actions';
import { AdminBreadcrumbs } from '@/components/admin/admin-breadcrumbs';
import { PageHeader } from '@/components/admin/page-header';
import { SectionTypePicker } from '@/components/admin/section-type-picker';
import {
  EMPTY_SECTION_VALUES,
  HomepageSectionForm,
} from '@/components/admin/homepage-section-form';

export const metadata: Metadata = { title: 'New section' };

const SECTION_TYPES = Object.keys(sectionConfigSchemas) as HomepageSectionType[];

/**
 * Creating a section is two steps in one URL: pick a type, then fill it in.
 *
 * The type is a `?type=` search param rather than client state so the choice
 * is linkable and survives a reload — and so the second step renders on the
 * server already knowing which fields it needs, instead of shipping all ten
 * field sets to the browser and hiding nine.
 */
export default async function NewHomepageSectionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminPermission('content.manage');

  const params = await searchParams;
  const raw = Array.isArray(params.type) ? params.type[0] : params.type;

  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE_NAME)?.value;
  const locale = cookieLocale && isLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE;
  const t = getAdminDictionary(locale);

  const breadcrumb = (
    <AdminBreadcrumbs
      dashboardLabel={t.shell.dashboard}
      trail={[
        { label: t.content.title, href: '/admin/content' },
        { label: t.content.newSectionTitle },
      ]}
    />
  );

  if (raw === undefined) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title={t.content.newSectionTitle}
          description={t.content.typeStepDescription}
          breadcrumb={breadcrumb}
        />
        <SectionTypePicker
          types={SECTION_TYPES}
          labels={{ types: { ...t.content.types }, typeHelp: { ...t.content.typeHelp } }}
        />
      </div>
    );
  }

  // A hand-typed `?type=` that names nothing is a 404, not a form for a
  // section type that cannot exist.
  if (!SECTION_TYPES.includes(raw as HomepageSectionType)) notFound();
  const type = raw as HomepageSectionType;

  const categories = await listCategoriesForContentAction(locale);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`${t.content.newSectionTitle} — ${t.content.types[type]}`}
        description={t.content.typeHelp[type]}
        breadcrumb={breadcrumb}
      />
      <HomepageSectionForm
        mode="create"
        type={type}
        locale={locale}
        initialValues={EMPTY_SECTION_VALUES}
        initialEnabled
        categories={categories}
        labels={buildSectionFormLabels(locale)}
        hasDraft={false}
      />
    </div>
  );
}
