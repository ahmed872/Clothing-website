import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/modules/core';

import { getStoreSettings } from './store-settings.service';
import { resetSettingsTable } from './testing';

beforeEach(async () => {
  await resetSettingsTable();
});

describe('getStoreSettings', () => {
  it('returns honest, complete fallback values when no row has been seeded yet', async () => {
    const settings = await getStoreSettings();
    expect(settings).toMatchObject({
      storeNameAr: 'لوكس درايف',
      storeNameEn: 'LuxeDrive',
      currency: 'SAR',
      defaultLocale: 'ar',
      logo: null,
    });
  });

  it('reads a real row when one exists', async () => {
    await db.storeSettings.create({
      data: {
        storeNameAr: 'متجري',
        storeNameEn: 'My Store',
        currency: 'AED',
        defaultLocale: 'EN',
        whatsappNumber: '+971500000000',
      },
    });

    const settings = await getStoreSettings();
    expect(settings).toMatchObject({
      storeNameAr: 'متجري',
      storeNameEn: 'My Store',
      currency: 'AED',
      defaultLocale: 'en',
      whatsappNumber: '+971500000000',
    });
  });
});
