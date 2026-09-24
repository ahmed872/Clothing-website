import { describe, expect, it } from 'vitest';

import {
  normalizePlaceOrderInput,
  normalizeSaudiPhone,
  placeOrderInputSchema,
  shippingAddressSchema,
} from './checkout-schemas';
import { generateOrderNumber, hashOrderAccessToken, isOrderNumberShape } from './order-identifiers';

const validAddress = {
  fullName: 'أحمد يوسف',
  phone: '+966512345678',
  city: 'الرياض',
  district: 'العليا',
  street: 'طريق الملك فهد',
  buildingNumber: '3210',
  additionalNumber: '4567',
  postalCode: '12211',
  country: 'SA' as const,
};

describe('normalizeSaudiPhone', () => {
  it.each([
    ['0512345678', '+966512345678'],
    ['512345678', '+966512345678'],
    ['966512345678', '+966512345678'],
    ['00966512345678', '+966512345678'],
    ['+966512345678', '+966512345678'],
    ['+966 51 234 5678', '+966512345678'],
    ['+966-51-234-5678', '+966512345678'],
    ['(0512) 345678', '+966512345678'],
  ])('normalises %s', (input, expected) => {
    expect(normalizeSaudiPhone(input)).toBe(expected);
  });

  it('leaves something it does not recognise alone rather than mangling it', () => {
    // Returning the stripped digits lets the schema reject it with a clear
    // message, instead of this function inventing a plausible-looking number.
    expect(normalizeSaudiPhone('+1 555 0100')).toBe('+15550100');
  });
});

describe('shippingAddressSchema', () => {
  it('accepts a complete Saudi address', () => {
    const result = shippingAddressSchema.safeParse(validAddress);
    expect(result.success).toBe(true);
  });

  it('accepts one without the optional national-address extras', () => {
    const { additionalNumber: _a, postalCode: _p, ...minimal } = validAddress;
    expect(shippingAddressSchema.safeParse(minimal).success).toBe(true);
  });

  it('treats empty optional strings as absent rather than invalid', () => {
    const result = shippingAddressSchema.safeParse({
      ...validAddress,
      postalCode: '',
      additionalNumber: '',
      notes: '',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.postalCode).toBeUndefined();
      expect(result.data.notes).toBeUndefined();
    }
  });

  it.each([
    ['district', ''],
    ['street', ''],
    ['buildingNumber', ''],
    ['city', ''],
  ])('refuses a blank %s — a courier cannot route without it', (field, value) => {
    const result = shippingAddressSchema.safeParse({ ...validAddress, [field]: value });
    expect(result.success).toBe(false);
  });

  it('refuses a malformed postal code instead of storing nonsense', () => {
    expect(shippingAddressSchema.safeParse({ ...validAddress, postalCode: '12' }).success).toBe(
      false,
    );
  });

  it('refuses a non-Saudi phone', () => {
    expect(shippingAddressSchema.safeParse({ ...validAddress, phone: '+15550100' }).success).toBe(
      false,
    );
  });
});

describe('placeOrderInputSchema', () => {
  const base = {
    contact: { email: 'Customer@Example.COM', phone: '0512345678' },
    shippingAddress: { ...validAddress, phone: '0512345678' },
    idempotencyKey: '3f1e6d5c-9a2b-4c8d-8e7f-0a1b2c3d4e5f',
  };

  it('accepts a normalised submission and lowercases the email', () => {
    const result = placeOrderInputSchema.safeParse(normalizePlaceOrderInput(base));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.contact.email).toBe('customer@example.com');
      expect(result.data.contact.phone).toBe('+966512345678');
      expect(result.data.shippingAddress.phone).toBe('+966512345678');
    }
  });

  it('refuses an invalid email', () => {
    const result = placeOrderInputSchema.safeParse(
      normalizePlaceOrderInput({ ...base, contact: { ...base.contact, email: 'not-an-email' } }),
    );
    expect(result.success).toBe(false);
  });

  it('requires a UUID idempotency key, so one client cannot guess another’s', () => {
    const result = placeOrderInputSchema.safeParse(
      normalizePlaceOrderInput({ ...base, idempotencyKey: 'key-1' }),
    );
    expect(result.success).toBe(false);
  });

  it('has no field for a price, a total, a discount or a status', () => {
    // The strongest statement this schema makes is about what it does not
    // accept: there is nothing here for a tampered payload to set (P10 §5).
    const shape = Object.keys(placeOrderInputSchema.shape);
    expect(shape).toEqual(['contact', 'shippingAddress', 'note', 'idempotencyKey']);
    for (const forbidden of ['total', 'totalMinor', 'price', 'discount', 'status', 'cartId']) {
      expect(shape).not.toContain(forbidden);
    }
  });

  it('strips unknown keys rather than passing them through', () => {
    const result = placeOrderInputSchema.safeParse(
      normalizePlaceOrderInput({ ...base, totalMinor: 1, status: 'CONFIRMED' } as never),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('totalMinor');
      expect(result.data).not.toHaveProperty('status');
    }
  });
});

describe('order numbers', () => {
  it('is date-prefixed and shaped as expected', () => {
    const number = generateOrderNumber(new Date(Date.UTC(2026, 8, 2)));
    expect(number).toMatch(/^LD-260902-[0-9A-HJKMNP-TV-Z]{6}$/);
    expect(isOrderNumberShape(number)).toBe(true);
  });

  it('is not sequential — 500 numbers on the same day are all different', () => {
    const day = new Date(Date.UTC(2026, 8, 2));
    const numbers = new Set(Array.from({ length: 500 }, () => generateOrderNumber(day)));
    expect(numbers.size).toBe(500);
  });

  it('omits the characters that get misread aloud', () => {
    const day = new Date(Date.UTC(2026, 8, 2));
    for (let i = 0; i < 200; i += 1) {
      const tail = generateOrderNumber(day).split('-')[2]!;
      expect(tail).not.toMatch(/[ILOU]/);
    }
  });

  it('rejects shapes that are not ours', () => {
    expect(isOrderNumberShape('LD-260902-ABCDEF')).toBe(true);
    expect(isOrderNumberShape('100001')).toBe(false);
    expect(isOrderNumberShape('LD-260902-ABCDE')).toBe(false);
    expect(isOrderNumberShape("LD-260902-ABCDEF' OR 1=1--")).toBe(false);
    expect(isOrderNumberShape('LD-260902-ILOUXX')).toBe(false);
  });
});

describe('access tokens', () => {
  it('hashes, and the hash is not the token', () => {
    const hash = hashOrderAccessToken('a-token');
    expect(hash).toHaveLength(64);
    expect(hash).not.toContain('a-token');
  });

  it('is stable for the same token and different for another', () => {
    expect(hashOrderAccessToken('one')).toBe(hashOrderAccessToken('one'));
    expect(hashOrderAccessToken('one')).not.toBe(hashOrderAccessToken('two'));
  });
});
