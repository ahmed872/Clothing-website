'use client';

import * as React from 'react';

/**
 * Wishlist, as a client-only placeholder (P05 explicit scope: `customers`/
 * `identity` aren't built yet, so there is no signed-in customer to persist
 * a real `WishlistItem` row against). Stored per-browser in `localStorage`,
 * keyed by product id — this is deliberately *not* wired to the real
 * `WishlistItem` Prisma model; presenting a `localStorage` list as if it
 * were server-persisted would be exactly the kind of fake success P04's
 * media work explicitly ruled out. A later phase that adds real customer
 * accounts replaces this file's storage, not its component call sites.
 */

const STORAGE_KEY = 'luxedrive-wishlist';

// `useSyncExternalStore` requires `getSnapshot` to return a referentially
// stable value when nothing has actually changed (React warns/loops
// otherwise) — this caches the last-seen raw string alongside its parsed
// array, so re-reading unchanged localStorage returns the same reference.
let cachedRaw: string | null = null;
let cachedIds: string[] = [];

function readAll(): string[] {
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return cachedIds;
  }
  if (raw === cachedRaw) return cachedIds;

  cachedRaw = raw;
  try {
    const parsed = raw ? JSON.parse(raw) : [];
    cachedIds = Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === 'string')
      : [];
  } catch {
    cachedIds = [];
  }
  return cachedIds;
}

function writeAll(ids: string[]): void {
  cachedRaw = JSON.stringify(ids);
  cachedIds = ids;
  try {
    localStorage.setItem(STORAGE_KEY, cachedRaw);
  } catch {
    // Private browsing / storage disabled — the toggle still works for this load, just doesn't persist.
  }
}

type Listener = () => void;
const listeners = new Set<Listener>();
function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

// A single shared reference, not a fresh `[]` per call — `useSyncExternalStore`
// requires `getServerSnapshot` to be referentially stable too, or React
// treats every render as "changed" and warns/loops.
const EMPTY_IDS: string[] = [];
function getServerSnapshot(): string[] {
  return EMPTY_IDS;
}

export function isWishlisted(productId: string): boolean {
  if (typeof window === 'undefined') return false;
  return readAll().includes(productId);
}

export function toggleWishlisted(productId: string): boolean {
  const current = readAll();
  const next = current.includes(productId)
    ? current.filter((id) => id !== productId)
    : [...current, productId];
  writeAll(next);
  notify();
  return next.includes(productId);
}

export function getWishlistIds(): string[] {
  if (typeof window === 'undefined') return [];
  return readAll();
}

/** Re-renders on any wishlist change, in this tab (`toggleWishlisted`) or
 * another (`storage` event) — a count badge in the header stays correct
 * after a toggle anywhere on the page without prop-drilling. */
export function useWishlist(): { ids: string[]; toggle: (productId: string) => boolean } {
  const ids = React.useSyncExternalStore(subscribe, readAll, getServerSnapshot);
  return { ids, toggle: toggleWishlisted };
}
