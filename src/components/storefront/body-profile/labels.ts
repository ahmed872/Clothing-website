import type { getDictionary } from '@/lib/i18n/dictionary';

/** The fit profile's copy, in whichever language the page is in. */
export type BodyProfileLabels = ReturnType<typeof getDictionary>['bodyProfile'];
