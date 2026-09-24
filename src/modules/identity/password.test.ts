import { describe, expect, it } from 'vitest';

import {
  hashPassword,
  validateCustomerPasswordPolicy,
  validatePasswordPolicy,
  verifyPassword,
} from './password';

describe('hashPassword / verifyPassword', () => {
  it('verifies the correct password against its own hash', async () => {
    const hash = await hashPassword('correct-horse-battery-9');
    expect(await verifyPassword('correct-horse-battery-9', hash)).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('correct-horse-battery-9');
    expect(await verifyPassword('wrong-password-attempt-1', hash)).toBe(false);
  });

  it('never stores the password in plaintext', async () => {
    const password = 'correct-horse-battery-9';
    const hash = await hashPassword(password);
    expect(hash).not.toContain(password);
  });

  it('salts every hash differently, even for the same password', async () => {
    const a = await hashPassword('same-password-12345');
    const b = await hashPassword('same-password-12345');
    expect(a).not.toBe(b);
    expect(await verifyPassword('same-password-12345', a)).toBe(true);
    expect(await verifyPassword('same-password-12345', b)).toBe(true);
  });

  it('rejects a malformed or unrecognized stored hash rather than throwing', async () => {
    expect(await verifyPassword('anything', 'not-a-real-hash')).toBe(false);
    expect(await verifyPassword('anything', 'md5:deadbeef')).toBe(false);
    expect(await verifyPassword('anything', '')).toBe(false);
  });
});

describe('validatePasswordPolicy', () => {
  it('accepts a password meeting the policy', () => {
    expect(validatePasswordPolicy('correct-horse-9')).toBeNull();
  });

  it('rejects a password shorter than 12 characters', () => {
    expect(validatePasswordPolicy('short1')).toMatch(/12/);
  });

  it('rejects a password with no number', () => {
    expect(validatePasswordPolicy('allletters-nodigits')).toMatch(/number/);
  });

  it('rejects a password with no letter', () => {
    expect(validatePasswordPolicy('123456789012')).toMatch(/letter/);
  });
});

/** The storefront's shorter, 8-character floor (P12 §4) — same
 * letter-and-number shape, deliberately less strict than the 12-character
 * admin policy above because a customer account carries no
 * store-operating privilege. */
describe('validateCustomerPasswordPolicy', () => {
  it('accepts an 8-character password meeting the policy', () => {
    expect(validateCustomerPasswordPolicy('abcdefg1')).toBeNull();
  });

  it('rejects a password shorter than 8 characters, even with a letter and a number', () => {
    expect(validateCustomerPasswordPolicy('abc123')).toMatch(/8/);
  });

  it('rejects a password with no number', () => {
    expect(validateCustomerPasswordPolicy('nodigitshere')).toMatch(/number/);
  });

  it('rejects a password with no letter', () => {
    expect(validateCustomerPasswordPolicy('12345678')).toMatch(/letter/);
  });

  it('does not accept a password that only meets the shorter customer floor as an admin password', () => {
    // The two policies are independent schemas, not one relaxed into the
    // other — an 8-character password that passes the customer policy must
    // still fail the stricter 12-character admin one.
    expect(validateCustomerPasswordPolicy('abcdefg1')).toBeNull();
    expect(validatePasswordPolicy('abcdefg1')).not.toBeNull();
  });
});
