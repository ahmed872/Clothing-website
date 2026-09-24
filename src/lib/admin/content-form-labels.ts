import { getAdminDictionary } from '@/lib/i18n/admin-dictionary';
import type { Locale } from '@/lib/i18n/locales';
import type { SectionFormLabels } from '@/components/admin/homepage-section-form';

/**
 * The label bag `HomepageSectionForm` needs, assembled once.
 *
 * The create and edit pages render the same form and would otherwise spell
 * out the same forty keys twice — two places to forget a translation. The
 * form takes a flat bag rather than the dictionary itself because a Server
 * Component may only hand a client component serializable props, and
 * because the handful of keys it borrows from `common` (save, cancel,
 * upload) genuinely live outside `content`.
 */
export function buildSectionFormLabels(locale: Locale): SectionFormLabels {
  const t = getAdminDictionary(locale);

  return {
    ...t.content,
    types: { ...t.content.types },
    typeHelp: { ...t.content.typeHelp },
    icons: { ...t.content.icons },
    requiredField: t.common.requiredField,
    errorGeneric: t.common.errorGeneric,
    chooseFile: t.common.chooseFile,
    uploading: t.common.uploading,
    uploadError: t.common.uploadError,
    save: t.common.save,
    saving: t.common.saving,
    cancel: t.common.cancel,
  };
}
