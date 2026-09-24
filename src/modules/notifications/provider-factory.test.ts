import { describe, expect, it, vi } from 'vitest';

/**
 * `EMAIL_PROVIDER` selection (P13 §1) — the same "one switch, one factory"
 * property `payments/provider-factory.ts` already has a real deployment
 * proving (`PAYMENT_PROVIDER`). `serverEnv` is mocked here specifically so
 * every branch (`console`/`smtp`/`test`) is exercised regardless of what
 * this repository's own `.env.test` happens to set.
 */

const serverEnvMock = vi.fn();
vi.mock('@/modules/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/modules/core')>();
  return { ...actual, serverEnv: serverEnvMock };
});

const { getEmailProvider, resetEmailProviderCache } = await import('./provider-factory');

function mockEnv(overrides: Partial<ReturnType<typeof import('@/modules/core').serverEnv>>) {
  serverEnvMock.mockReturnValue({
    EMAIL_PROVIDER: 'console',
    EMAIL_FROM_NAME: undefined,
    EMAIL_FROM: undefined,
    EMAIL_SMTP_HOST: undefined,
    EMAIL_SMTP_PORT: undefined,
    EMAIL_SMTP_USER: undefined,
    EMAIL_SMTP_PASSWORD: undefined,
    EMAIL_TEST_INBOX_DIR: '.local-storage/test-email-inbox',
    ...overrides,
  });
}

describe('getEmailProvider', () => {
  it('returns the console adapter by default', () => {
    mockEnv({ EMAIL_PROVIDER: 'console' });
    resetEmailProviderCache();
    expect(getEmailProvider().name).toBe('console');
  });

  it('returns the smtp adapter when configured', () => {
    mockEnv({ EMAIL_PROVIDER: 'smtp', EMAIL_SMTP_HOST: 'smtp.example.com', EMAIL_SMTP_PORT: 587 });
    resetEmailProviderCache();
    expect(getEmailProvider().name).toBe('smtp');
  });

  it('returns the test adapter when configured', () => {
    mockEnv({ EMAIL_PROVIDER: 'test' });
    resetEmailProviderCache();
    expect(getEmailProvider().name).toBe('test');
  });

  it('caches the adapter across calls until reset', () => {
    mockEnv({ EMAIL_PROVIDER: 'console' });
    resetEmailProviderCache();
    const first = getEmailProvider();

    mockEnv({ EMAIL_PROVIDER: 'test' });
    // No reset — the cached instance should still be returned.
    expect(getEmailProvider()).toBe(first);

    resetEmailProviderCache();
    expect(getEmailProvider().name).toBe('test');
  });
});
