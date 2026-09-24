import { expect, test } from '@playwright/test';

test.describe('storefront — i18n / RTL-LTR', () => {
  test('Arabic renders rtl with Arabic labels', async ({ page }) => {
    await page.goto('/ar/c/cars');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'سيارات' })).toBeVisible();
  });

  test('English renders ltr with English labels', async ({ page }) => {
    await page.goto('/en/c/cars');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.getByRole('heading', { name: 'Cars' })).toBeVisible();
  });

  test('the locale switcher crosses from Arabic to English on the same page', async ({ page }) => {
    await page.goto('/ar/p/mercedes-benz-s-class');
    await page.getByRole('link', { name: 'English' }).click();
    await expect(page).toHaveURL(/\/en\/p\/mercedes-benz-s-class$/);
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  });

  test('prices stay Latin-numeral and LTR-isolated even inside an Arabic paragraph', async ({
    page,
  }) => {
    await page.goto('/ar/p/mercedes-benz-s-class');
    const price = page.getByText('125,000.00').first();
    await expect(price).toHaveCSS('direction', 'ltr');
  });
});

test.describe('storefront — SEO', () => {
  test('product page has canonical + full hreflang alternates including x-default', async ({
    page,
  }) => {
    await page.goto('/ar/p/mercedes-benz-s-class');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      /\/ar\/p\/mercedes-benz-s-class$/,
    );
    await expect(page.locator('link[rel="alternate"][hreflang="ar"]')).toHaveCount(1);
    await expect(page.locator('link[rel="alternate"][hreflang="en"]')).toHaveCount(1);
    await expect(page.locator('link[rel="alternate"][hreflang="x-default"]')).toHaveCount(1);
  });

  test('product page carries Product and BreadcrumbList JSON-LD', async ({ page }) => {
    await page.goto('/ar/p/mercedes-benz-s-class');
    const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
    const parsed = blocks.map((b) => JSON.parse(b));
    expect(parsed.some((d) => d['@type'] === 'Product' && d.offers?.priceCurrency === 'SAR')).toBe(
      true,
    );
    expect(parsed.some((d) => d['@type'] === 'BreadcrumbList')).toBe(true);
  });

  test('search results are marked noindex', async ({ page }) => {
    await page.goto('/ar/search?q=tesla');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  });

  test('sitemap.xml lists a real product with hreflang alternates', async ({ request }) => {
    const response = await request.get('/sitemap.xml');
    expect(response.status()).toBe(200);
    const body = await response.text();
    expect(body).toContain('/ar/p/mercedes-benz-s-class');
    expect(body).toContain('hreflang="x-default"');
  });

  test('robots.txt allows the storefront and points at the sitemap', async ({ request }) => {
    const response = await request.get('/robots.txt');
    const body = await response.text();
    expect(body).toContain('Allow: /');
    expect(body).toContain('Disallow: /dev/');
    expect(body).toContain('Sitemap:');
  });
});
