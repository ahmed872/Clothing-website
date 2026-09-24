import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { serverEnv } from '@/modules/core';

import {
  EmailSendError,
  type EmailMessage,
  type EmailProviderAdapter,
  type EmailSendResult,
} from './provider';

/**
 * `EMAIL_PROVIDER="test"` — the deterministic adapter (P13 §15).
 *
 * Set only in `.env.test`, never in `.env` or a real deployment. It is not a
 * vendor stand-in and does not pretend to be one: it writes each attempted
 * send as one JSON file under `EMAIL_TEST_INBOX_DIR`, on local disk, so a
 * Playwright spec — a separate OS process from the running `pnpm dev`
 * server — can read what the app just tried to send and pull a
 * verification/reset link out of it (the exact need P13 §16's Journeys A/B
 * describe: "extract the test email from the test-provider inbox").
 *
 * Deterministic failure simulation, so E2E "Journey C" can exercise the
 * dispatcher's retry/permanent-failure paths without any extra plumbing: a
 * recipient address containing `+dispatch-fail-transient` always raises a
 * transient `EmailSendError`; one containing `+dispatch-fail-permanent`
 * always raises a permanent one. Any other address succeeds and is written
 * to the inbox. Both tags are deliberately unlikely to collide with a real
 * address a test would otherwise use.
 */

function inboxDir(): string {
  return path.resolve(/* turbopackIgnore: true */ process.cwd(), serverEnv().EMAIL_TEST_INBOX_DIR);
}

export interface TestInboxMessage extends EmailMessage {
  sentAt: string;
}

/** A strictly increasing per-process counter, zero-padded so it sorts as a
 * string the same way it sorts as a number. `sentAt` alone is not a safe
 * sort key: two sends from the same process can land in the same
 * millisecond, and `Array.prototype.sort` is not given anything to break
 * the tie with at that point — this is. */
let sequence = 0;
function nextSequence(): string {
  sequence += 1;
  return String(sequence).padStart(10, '0');
}

async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

/** A single dot in the local part (not the path) keeps this from ever
 * writing outside the recipient's own filename — recipients are always our
 * own email-format-validated strings, never used as a path directly. The
 * sequence number sorts before the random suffix so `readdir`'s own
 * (unspecified) ordering never matters — see `nextSequence`'s comment. */
function fileNameFor(to: string, seq: string): string {
  const safe = to.replace(/[^a-zA-Z0-9@._-]/g, '_');
  return `${safe}--${seq}--${randomUUID()}.json`;
}

export const testEmailProvider: EmailProviderAdapter = {
  name: 'test',

  async send(message: EmailMessage): Promise<EmailSendResult> {
    if (message.to.includes('+dispatch-fail-transient')) {
      throw new EmailSendError('transient', 'test provider: simulated transient failure');
    }
    if (message.to.includes('+dispatch-fail-permanent')) {
      throw new EmailSendError('permanent', 'test provider: simulated permanent failure');
    }

    const dir = inboxDir();
    await ensureDir(dir);
    const record: TestInboxMessage = { ...message, sentAt: new Date().toISOString() };
    const fileName = fileNameFor(message.to, nextSequence());
    await writeFile(path.join(dir, fileName), JSON.stringify(record, null, 2), 'utf8');

    return { providerMessageId: `test_${randomUUID()}` };
  },
};

/** Test/E2E-only: every message ever "sent" to `to`, oldest first. Reads the
 * same directory the adapter writes, so it works whether called from the
 * same process (a unit test) or a separate one (a Playwright spec against a
 * real running server). */
export async function readTestInbox(to: string): Promise<TestInboxMessage[]> {
  const dir = inboxDir();
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  // Sorted by filename, not `sentAt`: the sequence number embedded in the
  // filename (see `nextSequence`) is the real ordering guarantee, since two
  // sends can share the same millisecond.
  const matching = entries
    .filter((entry) => entry.startsWith(`${to.replace(/[^a-zA-Z0-9@._-]/g, '_')}--`))
    .sort();

  const messages: TestInboxMessage[] = [];
  for (const entry of matching) {
    const raw = await readFile(path.join(dir, entry), 'utf8');
    messages.push(JSON.parse(raw) as TestInboxMessage);
  }
  return messages;
}

/** Test-only: clears the whole inbox between test runs/files. */
export async function clearTestInbox(): Promise<void> {
  await rm(inboxDir(), { recursive: true, force: true });
}
