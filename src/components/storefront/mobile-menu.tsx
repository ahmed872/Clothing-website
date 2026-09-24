'use client';

import * as React from 'react';
import { Suspense } from 'react';
import { Menu } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent, DrawerTrigger } from '@/components/ui/drawer';
import { SearchBar } from '@/components/storefront/search-bar';
import { NavLinks, type NavCategory } from '@/components/storefront/nav-links';
import type { Locale } from '@/lib/i18n/locales';

export interface MobileMenuProps {
  locale: Locale;
  categories: NavCategory[];
  labels: { menu: string; close: string; search: string; allCategories: string };
}

/** The mobile-first nav: everything the desktop header spreads across a
 * horizontal bar collapses into one drawer here, rather than a cramped
 * shrunk-down copy of the desktop layout. */
export function MobileMenu({ locale, categories, labels }: MobileMenuProps) {
  const [open, setOpen] = React.useState(false);

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={labels.menu} className="md:hidden">
          <Menu aria-hidden="true" />
        </Button>
      </DrawerTrigger>
      <DrawerContent side="start" closeLabel={labels.close} className="flex w-72 flex-col gap-6">
        <Suspense fallback={<div className="h-10" />}>
          <SearchBar locale={locale} placeholder={labels.search} submitLabel={labels.search} />
        </Suspense>
        <div className="flex flex-col gap-1">
          <p className="px-3 text-caption font-medium text-(--color-text-muted) uppercase">
            {labels.allCategories}
          </p>
          <NavLinks
            locale={locale}
            categories={categories}
            className="flex-col items-stretch"
            onNavigate={() => setOpen(false)}
          />
        </div>
      </DrawerContent>
    </Drawer>
  );
}
