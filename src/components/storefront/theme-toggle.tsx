'use client';

import * as React from 'react';
import { Moon, Sun } from 'lucide-react';

import { Button } from '@/components/ui/button';

const STORAGE_KEY = 'luxedrive-theme';

type Listener = () => void;
const listeners = new Set<Listener>();

function readStoredTheme(): 'light' | 'dark' | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getServerSnapshot(): null {
  return null;
}

export interface ThemeToggleProps {
  label: string;
}

/**
 * Mirrors `THEME_BOOTSTRAP`'s contract exactly: an explicit choice is
 * `data-theme` on `<html>` plus the same localStorage key the inline
 * pre-hydration script reads, so a toggle here and a fresh page load never
 * disagree. With no explicit choice yet, the *system* preference decides
 * (globals.css's `prefers-color-scheme` block) — the first press always
 * flips away from whatever is currently rendered, system default included.
 *
 * `useSyncExternalStore`, not `useState` + `useEffect`, reads the stored
 * value — the server snapshot is always `null` (no localStorage there), so
 * there is no post-mount `setState` needed just to pick up what the client
 * actually has stored.
 */
export function ThemeToggle({ label }: ThemeToggleProps) {
  const stored = React.useSyncExternalStore(subscribe, readStoredTheme, getServerSnapshot);

  const toggle = () => {
    const current =
      stored ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private browsing / storage disabled — the toggle still works for this load.
    }
    for (const listener of listeners) listener();
  };

  return (
    <Button type="button" variant="ghost" size="icon" onClick={toggle} aria-label={label}>
      {stored === 'dark' ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
    </Button>
  );
}
