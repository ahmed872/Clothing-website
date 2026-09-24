import { describe, expect, it, vi } from 'vitest';

/**
 * **`analytics` never writes.** (`docs/architecture.md`: "Reporting that
 * mutates is how numbers stop matching reality.")
 *
 * The rule is worth a runtime proof rather than a code review, because the
 * way it gets broken is never a deliberate `db.order.update(...)` in a file
 * called `report.service.ts` — it is a convenience rollup, a "just cache
 * this total" or a `$executeRaw` added later by someone who did not read
 * the doc.
 *
 * So every exported query runs here against a Proxy over the real client
 * that passes reads through and throws on anything that could mutate: the
 * write methods on every model delegate, plus `$executeRaw*` and
 * `$transaction` (an interactive transaction would hand out a client this
 * proxy does not wrap, which is exactly the hole worth closing).
 *
 * A second, static assertion follows: the module's own source contains no
 * write call at all, which catches a write on a code path these particular
 * queries happen not to reach.
 *
 * Everything the mock factory needs is built inside `vi.hoisted`, because
 * `vi.mock` is hoisted above the imports and cannot close over an ordinary
 * module-level constant.
 */
const guard = vi.hoisted(() => {
  class AnalyticsWroteError extends Error {}

  const WRITE_METHODS = [
    'create',
    'createMany',
    'createManyAndReturn',
    'update',
    'updateMany',
    'updateManyAndReturn',
    'upsert',
    'delete',
    'deleteMany',
  ];

  const FORBIDDEN_CLIENT_METHODS = [
    '$executeRaw',
    '$executeRawUnsafe',
    '$queryRawUnsafe',
    '$transaction',
  ];

  function forbid(path: string): never {
    throw new AnalyticsWroteError(`analytics attempted a write: ${path}`);
  }

  /** Wraps one model delegate (`db.order`, `db.orderItem`, …). */
  function guardDelegate(delegate: object, model: string): object {
    return new Proxy(delegate, {
      get(target, property, receiver) {
        if (typeof property === 'string' && WRITE_METHODS.includes(property)) {
          return () => forbid(`${model}.${property}`);
        }
        return Reflect.get(target, property, receiver);
      },
    });
  }

  function wrap<T extends object>(client: T): T {
    return new Proxy(client, {
      get(target, property, receiver) {
        if (typeof property === 'string' && FORBIDDEN_CLIENT_METHODS.includes(property)) {
          return () => forbid(property);
        }
        const value = Reflect.get(target, property, receiver);
        // Model delegates are the objects carrying `create`/`update`/…; the
        // client's own `$`-prefixed members and internals are left alone.
        if (
          typeof property === 'string' &&
          !property.startsWith('$') &&
          !property.startsWith('_') &&
          value !== null &&
          typeof value === 'object'
        ) {
          return guardDelegate(value as object, property);
        }
        return value;
      },
    });
  }

  return {
    AnalyticsWroteError,
    WRITE_METHODS,
    wrap,
    /** Filled in by the mock factory, so the assertions below can reach the
     * exact client the module under test was handed. */
    ref: {} as { db?: Record<string, never> },
  };
});

vi.mock('@/modules/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/modules/core')>();
  const wrapped = guard.wrap(actual.db as unknown as object);
  guard.ref.db = wrapped as Record<string, never>;
  return { ...actual, db: wrapped };
});

const { db } = await import('@/modules/core');
const { getSalesReport, lastNDaysRange } = await import('./report.service');

describe('the guard itself works', () => {
  it('is the client the module under test received', () => {
    expect(db).toBe(guard.ref.db);
  });

  it('throws when a write is attempted through it', () => {
    expect(() => db.order.create({ data: {} as never })).toThrow(guard.AnalyticsWroteError);
    expect(() => db.orderItem.deleteMany()).toThrow(guard.AnalyticsWroteError);
    expect(() => db.$executeRawUnsafe('SELECT 1')).toThrow(guard.AnalyticsWroteError);
    expect(() => db.$transaction([])).toThrow(guard.AnalyticsWroteError);
  });

  it('lets reads through', async () => {
    await expect(db.order.count()).resolves.toBeTypeOf('number');
  });
});

describe('getSalesReport', () => {
  it('completes without touching a single write path', async () => {
    // Runs the whole report — totals, the previous window, the daily
    // series, top products, statuses, coupons and the refund counts.
    const report = await getSalesReport(lastNDaysRange(30));
    expect(report.revenueByDay).toHaveLength(30);
  });
});

describe('the module source', () => {
  it('contains no write call, on any code path', async () => {
    const { readdir, readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');

    const dir = new URL('.', import.meta.url).pathname;
    const files = (await readdir(dir)).filter(
      (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
    );
    expect(files.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of files) {
      const source = await readFile(join(dir, file), 'utf8');
      for (const method of [...guard.WRITE_METHODS, '$executeRaw', '$executeRawUnsafe']) {
        // `.<write>(` — a comment mentioning the word is not a call, so the
        // open paren is part of the match.
        if (new RegExp(`\\.${method.replace('$', '\\$')}\\s*\\(`).test(source)) {
          offenders.push(`${file}: .${method}(`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
