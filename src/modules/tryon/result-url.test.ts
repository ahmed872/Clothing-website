import { describe, expect, it } from 'vitest';

import { isAllowedResultUrl, parseResultHosts } from './result-url';

const HOSTS = ['results.example-cdn.test'];

describe('isAllowedResultUrl', () => {
  it('allows HTTPS from a listed host', () => {
    expect(isAllowedResultUrl('https://results.example-cdn.test/jobs/1.png', HOSTS)).toBe(true);
    expect(isAllowedResultUrl('https://RESULTS.example-cdn.test/1.png?sig=abc', HOSTS)).toBe(true);
  });

  it.each([
    'http://results.example-cdn.test/1.png',
    'javascript:alert(1)',
    'data:image/png;base64,AAAA',
    'blob:https://results.example-cdn.test/1',
    'file:///etc/passwd',
    '//results.example-cdn.test/1.png',
    '/relative.png',
    'https://results.example-cdn.test.attacker.example/1.png',
    'https://attacker.example/results.example-cdn.test/1.png',
    'https://sub.results.example-cdn.test/1.png',
    'https://user:pw@results.example-cdn.test/1.png',
    'https://results.example-cdn.test:8443/1.png',
    'https://results.example-cdn.test@attacker.example/1.png',
    '',
    `https://results.example-cdn.test/${'a'.repeat(2100)}`,
  ])('refuses %s', (url) => {
    expect(isAllowedResultUrl(url, HOSTS)).toBe(false);
  });

  it('allows nothing when no host is configured', () => {
    expect(isAllowedResultUrl('https://results.example-cdn.test/1.png', [])).toBe(false);
  });
});

describe('parseResultHosts', () => {
  it('reads a comma-separated list, trimmed and lower-cased', () => {
    expect(parseResultHosts(' A.example.test, b.example.test ,,')).toEqual([
      'a.example.test',
      'b.example.test',
    ]);
    expect(parseResultHosts(undefined)).toEqual([]);
  });
});
