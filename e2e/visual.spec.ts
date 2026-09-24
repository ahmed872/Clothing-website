import { expect, test } from '@playwright/test';

/**
 * Visual-regression baseline (P02 gate). Deliberately narrow: one snapshot
 * per theme of the core-components section, not a snapshot per variant of
 * every component — that would be hundreds of brittle images for no more
 * signal than these two give about a token or layout regression.
 */

test.describe('design gallery — visual', () => {
  test('core components, light theme', async ({ page }) => {
    await page.goto('/dev/gallery');
    const section = page.locator('#components');
    await section.scrollIntoViewIfNeeded();
    await expect(section).toHaveScreenshot('components-light.png', { maxDiffPixelRatio: 0.02 });
  });

  test('core components, dark theme', async ({ page }) => {
    await page.goto('/dev/gallery');
    await page.getByRole('button', { name: 'داكن' }).click();
    const section = page.locator('#components');
    await section.scrollIntoViewIfNeeded();
    await expect(section).toHaveScreenshot('components-dark.png', { maxDiffPixelRatio: 0.02 });
  });
});
