import { z } from 'zod';

import { AppError, db } from '@/modules/core';
import { getMediaAsset, toImageProp, type ResolvedMediaImage } from '@/modules/media';

/**
 * Single-row store identity (ADR-015) — currency, name, branding, SEO
 * defaults. Everything storefront/checkout/receipts/emails reads from here
 * rather than a scattered `process.env.STORE_NAME` or a hardcoded string,
 * so changing the store's name or currency is a data change, not a
 * deployment.
 */

export interface StoreSettingsView {
  storeNameAr: string;
  storeNameEn: string;
  logo: ResolvedMediaImage | null;
  logoDark: ResolvedMediaImage | null;
  favicon: ResolvedMediaImage | null;
  // Dynamic brand-colour theming (`StoreSettings.brandColor` /
  // `brandColorSecondary`) is a later-phase (admin branding) concern — P05's
  // storefront renders entirely from the P02 design system's static tokens,
  // so those two columns aren't surfaced here yet. Add them when a real
  // consumer needs them, rather than carrying an unused hex value through
  // application code (which `no-restricted-syntax` also wouldn't allow as a
  // literal — see `docs/environments.md` / `eslint.config.mjs`).
  currency: string;
  defaultLocale: 'ar' | 'en';
  contact: { phone?: string; email?: string; address?: string };
  socialLinks: Record<string, string>;
  seoDefaults: {
    titleAr?: string;
    titleEn?: string;
    descriptionAr?: string;
    descriptionEn?: string;
  };
  whatsappNumber: string | null;
}

/**
 * Used only when no `StoreSettings` row exists yet — a fresh database
 * before the (future, admin-authored) settings row is created, and in unit
 * tests that don't seed one. Never silently swapped for a real row's data;
 * every field a real row would carry is present here too, so a caller can't
 * tell "no settings yet" from "settings say so" by a field going missing.
 */
const FALLBACK_SETTINGS: Omit<StoreSettingsView, 'logo' | 'logoDark' | 'favicon'> = {
  storeNameAr: 'لوكس درايف',
  storeNameEn: 'LuxeDrive',
  currency: 'SAR',
  defaultLocale: 'ar',
  contact: {},
  socialLinks: {},
  seoDefaults: {},
  whatsappNumber: null,
};

async function resolveLogo(
  mediaId: string | null,
  locale: 'ar' | 'en',
): Promise<ResolvedMediaImage | null> {
  if (!mediaId) return null;
  const asset = await getMediaAsset(mediaId);
  return asset ? toImageProp(asset, locale) : null;
}

/**
 * A plain, uncached read — request-level and cross-instance caching is the
 * app layer's job (`unstable_cache`/route `revalidate`, per P05's caching
 * pass), not something this service hides from its callers or its tests.
 */
export async function getStoreSettings(locale: 'ar' | 'en' = 'ar'): Promise<StoreSettingsView> {
  const row = await db.storeSettings.findFirst();
  if (!row) return { ...FALLBACK_SETTINGS, logo: null, logoDark: null, favicon: null };

  return {
    storeNameAr: row.storeNameAr,
    storeNameEn: row.storeNameEn,
    logo: await resolveLogo(row.logoMediaId, locale),
    logoDark: await resolveLogo(row.logoDarkMediaId, locale),
    favicon: await resolveLogo(row.faviconMediaId, locale),
    currency: row.currency,
    defaultLocale: row.defaultLocale === 'AR' ? 'ar' : 'en',
    contact: (row.contact ?? {}) as StoreSettingsView['contact'],
    socialLinks: (row.socialLinks ?? {}) as StoreSettingsView['socialLinks'],
    seoDefaults: (row.seoDefaults ?? {}) as StoreSettingsView['seoDefaults'],
    whatsappNumber: row.whatsappNumber,
  };
}

// ---------------------------------------------------------------------------
// Admin (P15)
// ---------------------------------------------------------------------------

/**
 * The raw row, for the one screen that edits it.
 *
 * Deliberately not `StoreSettingsView`: that shape is built for rendering
 * (media ids already resolved to URLs, `defaultLocale` lowercased for the
 * storefront's own `Locale` type), and a form needs the stored values back
 * — the media *id* it will re-submit, not the URL it displayed. Two
 * consumers, two shapes, one row.
 *
 * `brandColor`/`brandColorSecondary` are deliberately absent, for the reason
 * `StoreSettingsView` above already gives: nothing renders them, so carrying
 * them here would mean a hex literal in application code with no consumer —
 * which `no-restricted-syntax` refuses, correctly. The columns keep their
 * schema defaults until a screen actually themes from them.
 */
export interface StoreSettingsRecord {
  storeNameAr: string;
  storeNameEn: string;
  logoMediaId: string | null;
  logoDarkMediaId: string | null;
  faviconMediaId: string | null;
  currency: string;
  defaultLocale: 'AR' | 'EN';
  contact: { phone?: string; email?: string; address?: string };
  socialLinks: Record<string, string>;
  seoDefaults: {
    titleAr?: string;
    titleEn?: string;
    descriptionAr?: string;
    descriptionEn?: string;
  };
  whatsappNumber: string | null;
  /** Null until the row is first created — the settings screen renders the
   * same defaults `FALLBACK_SETTINGS` above serves, and its first save
   * creates the row. Also the optimistic-concurrency token: absent means
   * "there is nothing to be stale against yet". */
  updatedAt: Date | null;
}

const CONTACT_KEYS = ['phone', 'email', 'address'] as const;

/** The social networks the storefront footer actually renders. A fixed list
 * rather than free-form keys: `socialLinks` is a JSON column, and letting an
 * admin invent keys would produce values nothing ever displays. */
export const SOCIAL_LINK_KEYS = ['instagram', 'x', 'facebook', 'tiktok', 'youtube'] as const;
export type SocialLinkKey = (typeof SOCIAL_LINK_KEYS)[number];

const DEFAULT_RECORD: StoreSettingsRecord = {
  storeNameAr: FALLBACK_SETTINGS.storeNameAr,
  storeNameEn: FALLBACK_SETTINGS.storeNameEn,
  logoMediaId: null,
  logoDarkMediaId: null,
  faviconMediaId: null,
  currency: FALLBACK_SETTINGS.currency,
  defaultLocale: 'AR',
  contact: {},
  socialLinks: {},
  seoDefaults: {},
  whatsappNumber: null,
  updatedAt: null,
};

function pickContact(value: unknown): StoreSettingsRecord['contact'] {
  const source = (value ?? {}) as Record<string, unknown>;
  const out: StoreSettingsRecord['contact'] = {};
  for (const key of CONTACT_KEYS) {
    const entry = source[key];
    if (typeof entry === 'string' && entry.length > 0) out[key] = entry;
  }
  return out;
}

function pickSocialLinks(value: unknown): Record<string, string> {
  const source = (value ?? {}) as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const key of SOCIAL_LINK_KEYS) {
    const entry = source[key];
    if (typeof entry === 'string' && entry.length > 0) out[key] = entry;
  }
  return out;
}

function pickSeoDefaults(value: unknown): StoreSettingsRecord['seoDefaults'] {
  const source = (value ?? {}) as Record<string, unknown>;
  const out: StoreSettingsRecord['seoDefaults'] = {};
  for (const key of ['titleAr', 'titleEn', 'descriptionAr', 'descriptionEn'] as const) {
    const entry = source[key];
    if (typeof entry === 'string' && entry.length > 0) out[key] = entry;
  }
  return out;
}

export async function getStoreSettingsRecord(): Promise<StoreSettingsRecord> {
  const row = await db.storeSettings.findFirst();
  if (!row) return { ...DEFAULT_RECORD };

  return {
    storeNameAr: row.storeNameAr,
    storeNameEn: row.storeNameEn,
    logoMediaId: row.logoMediaId,
    logoDarkMediaId: row.logoDarkMediaId,
    faviconMediaId: row.faviconMediaId,
    currency: row.currency,
    defaultLocale: row.defaultLocale,
    contact: pickContact(row.contact),
    socialLinks: pickSocialLinks(row.socialLinks),
    seoDefaults: pickSeoDefaults(row.seoDefaults),
    whatsappNumber: row.whatsappNumber,
    updatedAt: row.updatedAt,
  };
}

const optionalTrimmed = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value.length === 0 ? undefined : value))
    .optional();

const optionalUrl = z
  .string()
  .trim()
  .max(300)
  .transform((value) => (value.length === 0 ? undefined : value))
  .optional()
  .refine((value) => value === undefined || /^https?:\/\/\S+$/.test(value), {
    message: 'Must be an http(s) URL',
  });

const optionalMediaId = z
  .string()
  .trim()
  .transform((value) => (value.length === 0 ? null : value))
  .nullable()
  .refine(
    (value) =>
      value === null ||
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value),
    { message: 'Must be a media id' },
  );

/**
 * `currency` is an ISO 4217 code, not free text: it is the unit every stored
 * `...Minor` amount is denominated in (see the schema's own conventions
 * note), so a typo here would silently relabel every price in the store.
 * Three uppercase letters is the whole format.
 */
export const storeSettingsInputSchema = z.object({
  storeNameAr: z.string().trim().min(1).max(120),
  storeNameEn: z.string().trim().min(1).max(120),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, 'Currency must be a 3-letter ISO code'),
  defaultLocale: z.enum(['AR', 'EN']),
  whatsappNumber: optionalTrimmed(32),
  contact: z.object({
    phone: optionalTrimmed(32),
    email: z
      .string()
      .trim()
      .max(254)
      .transform((value) => (value.length === 0 ? undefined : value))
      .optional()
      .refine((value) => value === undefined || z.string().email().safeParse(value).success, {
        message: 'Must be an email address',
      }),
    address: optionalTrimmed(300),
  }),
  socialLinks: z.object(
    Object.fromEntries(SOCIAL_LINK_KEYS.map((key) => [key, optionalUrl])) as Record<
      SocialLinkKey,
      typeof optionalUrl
    >,
  ),
  seoDefaults: z.object({
    titleAr: optionalTrimmed(120),
    titleEn: optionalTrimmed(120),
    descriptionAr: optionalTrimmed(300),
    descriptionEn: optionalTrimmed(300),
  }),
  logoMediaId: optionalMediaId,
  logoDarkMediaId: optionalMediaId,
  faviconMediaId: optionalMediaId,
});

export type StoreSettingsInput = z.input<typeof storeSettingsInputSchema>;

/** Drops the keys whose value came back `undefined`, so an emptied field is
 * stored as an absent key rather than an explicit `undefined` Prisma would
 * reject inside a JSON column. */
function compact<T extends Record<string, unknown>>(value: T): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

/**
 * Writes the single settings row, creating it on first save.
 *
 * `expectedUpdatedAt` is the same optimistic-concurrency check every other
 * admin edit screen uses (P07/P08/P09): one settings row is shared by every
 * admin in the store, so two people with the form open is not a hypothetical
 * — one of them would otherwise silently overwrite the other's currency.
 * Passing `null` means "I loaded a store that had no row yet", which is only
 * still true if no row exists now.
 */
export async function updateStoreSettings(
  input: StoreSettingsInput,
  expectedUpdatedAt?: Date | null,
): Promise<StoreSettingsRecord> {
  const parsed = storeSettingsInputSchema.parse(input);

  const data = {
    storeNameAr: parsed.storeNameAr,
    storeNameEn: parsed.storeNameEn,
    currency: parsed.currency,
    defaultLocale: parsed.defaultLocale,
    whatsappNumber: parsed.whatsappNumber ?? null,
    contact: compact(parsed.contact),
    socialLinks: compact(parsed.socialLinks),
    seoDefaults: compact(parsed.seoDefaults),
    logoMediaId: parsed.logoMediaId,
    logoDarkMediaId: parsed.logoDarkMediaId,
    faviconMediaId: parsed.faviconMediaId,
  };

  await db.$transaction(async (tx) => {
    const existing = await tx.storeSettings.findFirst();

    if (!existing) {
      if (expectedUpdatedAt) {
        throw new AppError('CONFLICT', {
          internalMessage: 'Settings row expected but absent',
          details: { reasonCode: 'settings_changed_elsewhere' },
        });
      }
      await tx.storeSettings.create({ data });
      return;
    }

    if (expectedUpdatedAt === undefined) {
      // No token supplied at all — a non-UI caller (a script, a test). The
      // check is opt-in, exactly as it is for coupons.
    } else if (
      expectedUpdatedAt === null ||
      existing.updatedAt.getTime() !== expectedUpdatedAt.getTime()
    ) {
      throw new AppError('CONFLICT', {
        internalMessage: 'Stale expectedUpdatedAt on store settings update',
        details: { reasonCode: 'settings_changed_elsewhere' },
      });
    }

    await tx.storeSettings.update({ where: { id: existing.id }, data });
  });

  return getStoreSettingsRecord();
}
