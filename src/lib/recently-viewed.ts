'use client';

import * as React from 'react';

/**
 * Recently-viewed products — a client-only placeholder, same rule as
 * `wishlist.ts`: no personalization backend exists yet (`analytics`'s
 * `ProductView` table is an aggregation pipeline for view *counts*, not a
 * per-visitor history to read back, and there is no signed-in customer to
 * key a real history on). Denormalized display data is stored directly
 * (name/image/price), not just an id, so rendering the rail never needs a
 * second fetch for data the visitor's own browser already has.
 */

const STORAGE_KEY = 'luxedrive-recently-viewed';
const MAX_ENTRIES = 12;

export interface RecentlyViewedEntry {
  id: string;
  slug: string;
  nameAr: string;
  nameEn: string;
  image: { src: string; alt: string } | null;
  priceMinor: number;
  viewedAt: number;
}

let cachedRaw: string | null = null;
let cachedEntries: RecentlyViewedEntry[] = [];

function readAll(): RecentlyViewedEntry[] {
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return cachedEntries;
  }
  if (raw === cachedRaw) return cachedEntries;

  cachedRaw = raw;
  try {
    const parsed = raw ? JSON.parse(raw) : [];
    cachedEntries = Array.isArray(parsed) ? parsed : [];
  } catch {
    cachedEntries = [];
  }
  return cachedEntries;
}

function writeAll(entries: RecentlyViewedEntry[]): void {
  cachedRaw = JSON.stringify(entries);
  cachedEntries = entries;
  try {
    localStorage.setItem(STORAGE_KEY, cachedRaw);
  } catch {
    // Private browsing / storage disabled — this load just doesn't persist it.
  }
}

/** Called once from the product page itself — records *this* view. */
export function recordProductView(entry: Omit<RecentlyViewedEntry, 'viewedAt'>): void {
  const current = readAll().filter((e) => e.id !== entry.id);
  const next = [{ ...entry, viewedAt: Date.now() }, ...current].slice(0, MAX_ENTRIES);
  writeAll(next);
}

function subscribe(): () => void {
  return () => {};
}

const EMPTY: RecentlyViewedEntry[] = [];
function getServerSnapshot(): RecentlyViewedEntry[] {
  return EMPTY;
}

/** Reads the list, excluding `excludeProductId` (the product currently
 * being viewed — it doesn't belong in its own "recently viewed" rail). No
 * live cross-tab sync needed: this only ever changes on a full page
 * navigation to a new product, which already re-renders everything. */
export function useRecentlyViewed(excludeProductId?: string): RecentlyViewedEntry[] {
  const all = React.useSyncExternalStore(subscribe, readAll, getServerSnapshot);
  return React.useMemo(
    () => (excludeProductId ? all.filter((e) => e.id !== excludeProductId) : all),
    [all, excludeProductId],
  );
}
