/** Test-only helpers, same pattern as `identity/testing.ts`. Not exported
 * from `./index`; only reachable via a deep import from a `*.test.ts` file
 * (see the ESLint override for that glob). E2E specs cannot use this file —
 * Playwright does not resolve the `@/` alias — and instead read
 * `EMAIL_TEST_INBOX_DIR` directly via their own small fixture; see
 * `e2e/fixtures/email-inbox.ts`. */
export { clearTestInbox, readTestInbox, type TestInboxMessage } from './test-provider';
export { resetEmailProviderCache } from './provider-factory';
export { resetSmtpTransportCache } from './smtp-provider';
