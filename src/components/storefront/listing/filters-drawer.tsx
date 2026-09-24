'use client';

import { SlidersHorizontal } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent, DrawerTrigger } from '@/components/ui/drawer';
import {
  FiltersPanel,
  type FiltersPanelProps,
} from '@/components/storefront/listing/filters-panel';
import { getDictionary } from '@/lib/i18n/dictionary';
import type { Locale } from '@/lib/i18n/locales';

/** The mobile counterpart to the desktop sidebar `FiltersPanel` — same
 * component, different chrome, so the two can never drift out of sync. */
export function FiltersDrawer(props: FiltersPanelProps) {
  const t = getDictionary(props.locale as Locale);

  return (
    <Drawer>
      <DrawerTrigger asChild>
        <Button type="button" variant="outline" className="gap-2 lg:hidden">
          <SlidersHorizontal className="size-4" aria-hidden="true" />
          {t.listing.filters}
        </Button>
      </DrawerTrigger>
      <DrawerContent side="start" closeLabel={props.locale === 'ar' ? 'إغلاق' : 'Close'}>
        <FiltersPanel {...props} className="overflow-y-auto" />
      </DrawerContent>
    </Drawer>
  );
}
