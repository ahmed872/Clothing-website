import { describe, expect, it } from 'vitest';

import { dictionary } from './dictionary';

/**
 * The fit profile's copy (clothing P01) is a large, nested section, and a
 * key present in one language but not the other would render as a blank
 * on that page. So: identical shape in both languages, nothing empty,
 * Arabic on the Arabic side, and no Arabic leaking into the English page.
 */

type Tree = string | readonly string[] | { readonly [key: string]: Tree };

function leaves(tree: Tree, path = ''): [string, string][] {
  if (typeof tree === 'string') return [[path, tree]];
  if (Array.isArray(tree)) return tree.flatMap((value, i) => leaves(value, `${path}[${i}]`));
  return Object.entries(tree).flatMap(([key, value]) =>
    leaves(value as Tree, path ? `${path}.${key}` : key),
  );
}

const ARABIC = /[؀-ۿ]/;

for (const section of ['bodyProfile', 'sizing'] as const) {
  const ar = leaves(dictionary.ar[section] as Tree);
  const en = leaves(dictionary.en[section] as Tree);

  describe(`dictionary — ${section}`, () => {
    it('has exactly the same keys in Arabic and English', () => {
      expect(ar.map(([path]) => path)).toEqual(en.map(([path]) => path));
    });

    it('leaves nothing empty', () => {
      for (const [path, value] of [...ar, ...en]) expect(value.trim(), path).not.toBe('');
    });

    it('writes the Arabic side in Arabic', () => {
      for (const [path, value] of ar) expect(value, path).toMatch(ARABIC);
    });

    it('keeps Arabic out of the English side', () => {
      for (const [path, value] of en) expect(value, path).not.toMatch(ARABIC);
    });
  });
}

describe('dictionary — account', () => {
  it('names the account link in both languages', () => {
    expect(dictionary.ar.account.navBodyProfile).toMatch(ARABIC);
    expect(dictionary.en.account.navBodyProfile).not.toMatch(ARABIC);
  });
});
