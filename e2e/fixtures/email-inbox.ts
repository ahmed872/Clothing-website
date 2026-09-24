import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { config as loadDotenv } from 'dotenv';

/**
 * P13's own small test-provider client, for E2E specs only.
 *
 * Playwright does not resolve this project's `@/` alias (no existing e2e
 * spec uses it — confirmed before writing this file), so this duplicates
 * the tiny amount of file-reading logic `@/modules/notifications/test-
 * provider.ts` already has, rather than importing it. It reads the exact
 * same directory and file-naming scheme that module writes to, so the two
 * stay in sync by construction, not by convention alone.
 *
 * `pnpm dev` (this suite's `webServer`, see `playwright.config.ts`) loads
 * plain `.env`, not `.env.test` — the same reason `payment-provider-stub.mjs`
 * reads `.env` unless `NODE_ENV=test` is set, which nothing here does. So
 * `.env`'s own `EMAIL_PROVIDER="test"` and `EMAIL_DISPATCH_SECRET` are what
 * the running server actually uses, and what this file reads to match it.
 */
loadDotenv({ path: '.env', quiet: true });

const EMAIL_DISPATCH_SECRET = process.env.EMAIL_DISPATCH_SECRET;
const EMAIL_TEST_INBOX_DIR = process.env.EMAIL_TEST_INBOX_DIR ?? '.local-storage/test-email-inbox';

if (!EMAIL_DISPATCH_SECRET) {
  throw new Error('e2e/fixtures/email-inbox.ts: EMAIL_DISPATCH_SECRET is not set in .env');
}

export interface TestInboxMessage {
  to: string;
  toName: string | null;
  subject: string;
  html: string;
  text: string;
  sentAt: string;
}

/**
 * Calls the real, bearer-secret-protected dispatch endpoint — the same
 * request Vercel Cron would make in production. Returns the JSON summary
 * (`{ok, claimed, sent, retried, failed, reclaimed}`) so a test can assert on it
 * directly rather than only inferring success from the inbox.
 */
export async function triggerEmailDispatch(
  request: import('@playwright/test').APIRequestContext,
  baseUrl = 'http://127.0.0.1:3000',
): Promise<{
  ok: boolean;
  claimed: number;
  sent: number;
  retried: number;
  failed: number;
  reclaimed: number;
}> {
  const response = await request.get(`${baseUrl}/api/internal/email-dispatch`, {
    headers: { Authorization: `Bearer ${EMAIL_DISPATCH_SECRET}` },
  });
  return response.json();
}

function inboxDir(): string {
  return path.resolve(process.cwd(), EMAIL_TEST_INBOX_DIR);
}

/**
 * Calls the dispatch endpoint repeatedly until `to`'s inbox is non-empty, or
 * `timeoutMs` elapses — then returns that inbox.
 *
 * A single `triggerEmailDispatch` call is not guaranteed to include one
 * specific address's event: `dispatchPendingEmailEvents` claims up to
 * `BATCH_SIZE` PENDING rows *across the whole outbox*, oldest
 * `nextAttemptAt` first, and this suite runs many spec files as well as
 * this file's own other tests in parallel (`fullyParallel: true`) — every
 * one of them registering accounts and queuing their own verification
 * events into that same shared table. A real caller in this position (a
 * customer whose registration just missed one 5-minute cron tick) simply
 * sees their email a little later, once a subsequent tick reaches it; this
 * mirrors that by calling dispatch again rather than assuming the first
 * call was sufficient. It never weakens what is checked — the message
 * still has to actually arrive — only how many ticks it is allowed to take.
 */
export async function dispatchUntilDelivered(
  request: import('@playwright/test').APIRequestContext,
  to: string,
  timeoutMs = 15_000,
): Promise<TestInboxMessage[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await triggerEmailDispatch(request);
    const inbox = await readTestInbox(to, 500);
    if (inbox.length > 0 || Date.now() > deadline) return inbox;
  }
}

/** Every message "sent" to `to` so far, oldest first — polls briefly
 * because the dispatch endpoint's own response only guarantees the outbox
 * transaction committed, and this reads the filesystem write that happens
 * just after it in the same request; in practice both are done before the
 * HTTP response returns, but polling costs nothing when they already are. */
export async function readTestInbox(to: string, timeoutMs = 5000): Promise<TestInboxMessage[]> {
  const safe = to.replace(/[^a-zA-Z0-9@._-]/g, '_');
  const dir = inboxDir();
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      entries = [];
    }
    const matching = entries.filter((entry) => entry.startsWith(`${safe}--`)).sort();
    if (matching.length > 0 || Date.now() > deadline) {
      const messages: TestInboxMessage[] = [];
      for (const entry of matching) {
        const raw = await readFile(path.join(dir, entry), 'utf8');
        messages.push(JSON.parse(raw) as TestInboxMessage);
      }
      return messages;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** Pulls the first `https://…` URL matching `pathIncludes` out of a
 * message's plain-text body — the fallback link every template guarantees
 * (see `templates.ts`), so this never depends on HTML structure. */
export function extractLink(message: TestInboxMessage, pathIncludes: string): string {
  const pattern = new RegExp(`https?://\\S*${pathIncludes}\\S*`);
  const match = pattern.exec(message.text);
  if (!match) {
    throw new Error(
      `extractLink: no link containing "${pathIncludes}" in message text: ${message.text}`,
    );
  }
  return match[0];
}
