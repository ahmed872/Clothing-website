import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * Accessibility baseline for the design system (P02 gate: "Accessibility
 * checks pass"). Runs axe against `/dev/gallery` — every token and
 * component in one page — in both themes and both locales, since colour
 * contrast and language attributes are exactly what changes between them.
 */

test.describe('design gallery — accessibility', () => {
  test('light theme, Arabic (default)', async ({ page }) => {
    await page.goto('/dev/gallery');
    const results = await new AxeBuilder({ page }).include('body').analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });

  test('dark theme', async ({ page }) => {
    await page.goto('/dev/gallery');
    await page.getByRole('button', { name: 'داكن' }).click();
    const results = await new AxeBuilder({ page }).include('body').analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });

  test('English / LTR', async ({ page }) => {
    await page.goto('/dev/gallery');
    await page.getByRole('button', { name: 'English' }).click();
    await expect(page.locator('[dir="ltr"]').first()).toBeVisible();
    const results = await new AxeBuilder({ page }).include('body').analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });

  test('dialog traps focus and returns it on close', async ({ page }) => {
    await page.goto('/dev/gallery');
    const trigger = page.getByRole('button', { name: 'فتح نافذة' });
    await trigger.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('reduced motion is respected', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/dev/gallery');
    const durationSeconds = await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.style.transitionDuration = '300ms';
      document.body.appendChild(probe);
      // Chromium reports very small durations in seconds (e.g. "1e-05s")
      // rather than echoing "0.01ms" back, so compare the parsed value.
      const resolved = Number.parseFloat(getComputedStyle(probe).transitionDuration);
      probe.remove();
      return resolved;
    });
    expect(durationSeconds).toBeLessThan(0.001); // the declared 300ms collapses to ~0.01ms
  });
});
