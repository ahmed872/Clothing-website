import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import type { HomepageSectionType } from '@generated/prisma';

import { getHomepageSection } from '@/modules/content';
import { getMediaAsset, getMediaPublicUrl } from '@/modules/media';
import { DEFAULT_LOCALE, LOCALE_COOKIE_NAME, isLocale } from '@/lib/i18n/locales';
import { getAdminDictionary } from '@/lib/i18n/admin-dictionary';
import { requireAdminPermission } from '@/lib/admin/require-admin';
import { buildSectionFormLabels } from '@/lib/admin/content-form-labels';
import {
  listCategoriesForContentAction,
  resolveProductLabelsAction,
} from '@/lib/admin/content-actions';
import { AdminBreadcrumbs } from '@/components/admin/admin-breadcrumbs';
import { PageHeader } from '@/components/admin/page-header';
import {
  EMPTY_SECTION_VALUES,
  HomepageSectionForm,
  type SectionFormValues,
  type TestimonialDraft,
  type TrustBlockDraft,
} from '@/components/admin/homepage-section-form';

export const metadata: Metadata = { title: 'Edit section' };

interface PageParams {
  params: Promise<{ id: string }>;
}

function str(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === 'string' ? value : '';
}

function ids(source: Record<string, unknown>, key: string): string[] {
  const value = source[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

/**
 * Turn a stored config back into the flat form state.
 *
 * Deliberately tolerant: it reads whatever keys are there and ignores the
 * rest, rather than parsing against the type's schema first. A row written
 * before a schema changed, or edited by hand, must still open in the form so
 * it can be *fixed* — refusing to render it would leave the only repair
 * path outside the admin panel, which is the situation this whole screen
 * exists to end. The save is still validated by the server.
 */
function toFormValues(config: unknown): SectionFormValues {
  const source = (typeof config === 'object' && config !== null ? config : {}) as Record<
    string,
    unknown
  >;
  const items = Array.isArray(source.items) ? (source.items as Record<string, unknown>[]) : [];
  const tone = str(source, 'tone');
  const limit = source.limit;

  return {
    ...EMPTY_SECTION_VALUES,
    titleAr: str(source, 'titleAr'),
    titleEn: str(source, 'titleEn'),
    subtitleAr: str(source, 'subtitleAr'),
    subtitleEn: str(source, 'subtitleEn'),
    bodyAr: str(source, 'bodyAr'),
    bodyEn: str(source, 'bodyEn'),
    ctaLabelAr: str(source, 'ctaLabelAr'),
    ctaLabelEn: str(source, 'ctaLabelEn'),
    ctaHref: str(source, 'ctaHref'),
    tone: tone === 'accent' || tone === 'neutral' ? tone : 'brand',
    limit: typeof limit === 'number' ? String(limit) : EMPTY_SECTION_VALUES.limit,
    categoryId: str(source, 'categoryId'),
    testimonials: items.map<TestimonialDraft>((item) => ({
      authorName: str(item, 'authorName'),
      authorTitleAr: str(item, 'authorTitleAr'),
      authorTitleEn: str(item, 'authorTitleEn'),
      quoteAr: str(item, 'quoteAr'),
      quoteEn: str(item, 'quoteEn'),
      rating: typeof item.rating === 'number' ? String(item.rating) : '',
    })),
    trustBlocks: items.map<TrustBlockDraft>((item) => ({
      icon: str(item, 'icon') || 'BadgeCheck',
      titleAr: str(item, 'titleAr'),
      titleEn: str(item, 'titleEn'),
      descriptionAr: str(item, 'descriptionAr'),
      descriptionEn: str(item, 'descriptionEn'),
    })),
  };
}

export default async function EditHomepageSectionPage({ params }: PageParams) {
  await requireAdminPermission('content.manage');

  const { id } = await params;
  const section = await getHomepageSection(id);
  if (!section) notFound();

  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE_NAME)?.value;
  const locale = cookieLocale && isLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE;
  const t = getAdminDictionary(locale);

  // The draft is what the form opens with when there is one: an edit in
  // progress is what this person was last working on, and showing them the
  // published copy instead would silently discard it on the next save.
  const editing = section.draftConfig ?? section.config;
  const source = (typeof editing === 'object' && editing !== null ? editing : {}) as Record<
    string,
    unknown
  >;

  const categories = await listCategoriesForContentAction(locale);
  const categoryIds = ids(source, 'categoryIds');
  const productIds = ids(source, 'productIds');

  const mediaId = typeof source.imageMediaId === 'string' ? source.imageMediaId : null;
  const asset = mediaId ? await getMediaAsset(mediaId) : null;

  const values: SectionFormValues = {
    ...toFormValues(editing),
    image: asset ? { id: asset.id, src: getMediaPublicUrl(asset) } : null,
    products: await resolveProductLabelsAction(productIds, locale),
    // Curated in the stored order, and a category deleted since simply
    // drops out — same as a deleted product.
    categories: categoryIds
      .map((categoryId) => categories.find((option) => option.id === categoryId))
      .filter((option): option is (typeof categories)[number] => option !== undefined),
  };

  const type = section.type as HomepageSectionType;
  const typeLabel = (t.content.types as Record<string, string>)[type] ?? type;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`${t.content.editSectionTitle} — ${typeLabel}`}
        description={(t.content.typeHelp as Record<string, string>)[type]}
        breadcrumb={
          <AdminBreadcrumbs
            dashboardLabel={t.shell.dashboard}
            trail={[
              { label: t.content.title, href: '/admin/content' },
              { label: t.content.editSectionTitle },
            ]}
          />
        }
      />
      <HomepageSectionForm
        mode="edit"
        type={type}
        sectionId={section.id}
        locale={locale}
        initialValues={values}
        initialEnabled={section.enabled}
        categories={categories}
        labels={buildSectionFormLabels(locale)}
        hasDraft={section.draftConfig !== null}
      />
    </div>
  );
}
