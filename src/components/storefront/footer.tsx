import Link from 'next/link';
import { Mail, MapPin, MessageCircle, Phone } from 'lucide-react';

import { getCachedCategoryTree, getCachedStoreSettings } from '@/lib/cached-queries';
import { getDictionary } from '@/lib/i18n/dictionary';
import { whatsappHref } from '@/lib/whatsapp';
import type { Locale } from '@/lib/i18n/locales';

export interface StorefrontFooterProps {
  locale: Locale;
}

/**
 * The storefront footer.
 *
 * Everything here is the store's own data. It did not use to be: a third
 * column headed "Sample price" rendered a hardcoded `1,999.00` — a leftover
 * from the design-system phase that demonstrated the money formatter, and
 * that a real customer read as a price for something. It is replaced by the
 * contact details the settings screen already collects, which is what a
 * footer is for.
 *
 * Each contact row renders only when the store filled it in, so a store
 * with no address does not get an empty line, and a store with nothing at
 * all does not get an empty column.
 */
export async function StorefrontFooter({ locale }: StorefrontFooterProps) {
  const t = getDictionary(locale);
  const [settings, categories] = await Promise.all([
    getCachedStoreSettings(locale),
    getCachedCategoryTree(),
  ]);
  const storeName = locale === 'ar' ? settings.storeNameAr : settings.storeNameEn;
  const year = new Date().getFullYear();

  const whatsapp = whatsappHref(settings.whatsappNumber);
  const { phone, email, address } = settings.contact;
  const hasContact = Boolean(whatsapp || settings.whatsappNumber || phone || email || address);

  return (
    <footer className="border-t border-(--color-border) bg-(--color-surface-raised)">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-3">
        <div className="flex flex-col gap-2">
          <p className="text-h6 font-bold text-(--color-text)">{storeName}</p>
          <p className="text-small text-(--color-text-muted)">
            {locale === 'ar'
              ? `الأسعار بعملة ${settings.currency} وتشمل الضريبة عند الاقتضاء.`
              : `Prices in ${settings.currency}, tax included where applicable.`}
          </p>
        </div>

        {categories.length > 0 ? (
          <div className="flex flex-col gap-2">
            <p className="text-label text-(--color-text-muted) uppercase">{t.nav.allCategories}</p>
            <ul className="flex flex-col gap-1.5">
              {categories.map((category) => (
                <li key={category.slug}>
                  <Link
                    href={`/${locale}/c/${category.slug}`}
                    className="text-small text-(--color-text-muted) transition-colors duration-(--duration-fast) hover:text-(--color-text)"
                  >
                    {locale === 'ar' ? category.nameAr : category.nameEn}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {hasContact ? (
          <div className="flex flex-col gap-2">
            <p className="text-label text-(--color-text-muted) uppercase">
              {t.footerSection.contact}
            </p>
            <ul className="flex flex-col gap-1.5">
              {settings.whatsappNumber ? (
                <li>
                  {/* A number the owner typed in national format cannot be
                      dialled internationally, so it is shown as text rather
                      than as a link that would open a chat with nobody. */}
                  {whatsapp ? (
                    <a
                      href={whatsapp}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-2 text-small text-(--color-text-muted) transition-colors duration-(--duration-fast) hover:text-(--color-text)"
                    >
                      <MessageCircle className="size-4 shrink-0" aria-hidden="true" />
                      <span>{t.footerSection.whatsapp}</span>
                      <span className="tabular-nums" dir="ltr">
                        {settings.whatsappNumber}
                      </span>
                    </a>
                  ) : (
                    <span className="flex items-center gap-2 text-small text-(--color-text-muted)">
                      <MessageCircle className="size-4 shrink-0" aria-hidden="true" />
                      <span>{t.footerSection.whatsapp}</span>
                      <span className="tabular-nums" dir="ltr">
                        {settings.whatsappNumber}
                      </span>
                    </span>
                  )}
                </li>
              ) : null}

              {phone ? (
                <li>
                  <a
                    href={`tel:${phone.replace(/\s/g, '')}`}
                    className="flex items-center gap-2 text-small text-(--color-text-muted) transition-colors duration-(--duration-fast) hover:text-(--color-text)"
                  >
                    <Phone className="size-4 shrink-0" aria-hidden="true" />
                    <span className="sr-only">{t.footerSection.phone}</span>
                    <span className="tabular-nums" dir="ltr">
                      {phone}
                    </span>
                  </a>
                </li>
              ) : null}

              {email ? (
                <li>
                  <a
                    href={`mailto:${email}`}
                    className="flex items-center gap-2 text-small text-(--color-text-muted) transition-colors duration-(--duration-fast) hover:text-(--color-text)"
                  >
                    <Mail className="size-4 shrink-0" aria-hidden="true" />
                    <span className="sr-only">{t.footerSection.email}</span>
                    <span dir="ltr">{email}</span>
                  </a>
                </li>
              ) : null}

              {address ? (
                <li className="flex items-start gap-2 text-small text-(--color-text-muted)">
                  <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <span className="sr-only">{t.footerSection.address}</span>
                  <span>{address}</span>
                </li>
              ) : null}
            </ul>
          </div>
        ) : null}
      </div>

      <div className="border-t border-(--color-border) px-4 py-4 text-center text-caption text-(--color-text-muted) sm:px-6">
        © {year} {storeName}
      </div>
    </footer>
  );
}
