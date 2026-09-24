import AxeBuilder from '@axe-core/playwright';
import type { Browser, Page, Request } from '@playwright/test';
import { expect, test } from '@playwright/test';

/**
 * Clothing P01 — the fit profile, as a customer uses it: sign-in gate, the
 * full save/reload/edit journey in Arabic, English, mobile, validation,
 * the illustration following the form, delete, accessibility, and the two
 * attacks that matter most for private data — reading another customer's
 * profile, and a cross-site request saving into someone's profile.
 *
 * Every test registers its own customer, so none depends on another's data.
 */

test.describe.configure({ timeout: 120_000 });

const PAGE = (locale: 'ar' | 'en') => `/${locale}/account/body-profile`;

function uniqueEmail(tag: string): string {
  return `p01-${tag}-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.com`;
}

const PASSWORD = 'Password123';

async function registerAndSignIn(
  page: Page,
  locale: 'ar' | 'en',
  tag: string = locale,
): Promise<string> {
  const email = uniqueEmail(tag);
  await page.goto(`/${locale}/account/register`);
  const form = page.locator('main form');
  await form.locator('input[name="name"]').fill(locale === 'ar' ? 'عميل الاختبار' : 'Fit Tester');
  await form.locator('input[name="email"]').fill(email);
  await form.locator('input[name="password"]').fill(PASSWORD);
  await form.locator('input[name="passwordConfirmation"]').fill(PASSWORD);
  await form.locator('button[type="submit"]').click();
  await page.waitForURL(/\/account$/, { timeout: 30_000 });
  return email;
}

async function openProfile(page: Page, locale: 'ar' | 'en'): Promise<void> {
  await page.goto(PAGE(locale), { waitUntil: 'networkidle' });
  await expect(page.getByTestId('avatar-preview')).toBeVisible();
}

const field = (page: Page, name: string) => page.getByRole('textbox', { name, exact: true });
const choice = (page: Page, name: string) => page.getByRole('radio', { name, exact: true });
const avatar = (page: Page) => page.getByTestId('avatar-preview').locator('svg');

async function axe(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).include('body').exclude('nextjs-portal').analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

async function saveEnglishMinimum(page: Page, height = '177'): Promise<void> {
  await choice(page, 'Male').click();
  await field(page, 'Height (cm)').fill(height);
  await field(page, 'Weight (kg)').fill('82');
  await field(page, 'Waist (cm)').fill('88');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByText('Fit profile saved').first()).toBeVisible({ timeout: 20_000 });
}

test('a signed-out visitor is sent to sign in, and never sees the page', async ({ page }) => {
  await page.goto(PAGE('ar'));
  await expect(page).toHaveURL(/\/ar\/account\/login$/);
  await page.goto(PAGE('en'));
  await expect(page).toHaveURL(/\/en\/account\/login$/);
});

test('the Arabic journey: fill the essentials, save, reload, edit, and dress the illustration', async ({
  page,
}) => {
  await registerAndSignIn(page, 'ar');
  await page.getByRole('link', { name: 'ملف المقاسات' }).click();
  await page.waitForURL(/\/ar\/account\/body-profile$/);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { name: 'ملف المقاسات', level: 2 })).toBeVisible();
  await expect(page.getByTestId('completion-percent')).toHaveText('ملفك مكتمل بنسبة 0%');

  // The essentials — the waist typed in Arabic-Indic digits.
  await choice(page, 'أنثى').click();
  await field(page, 'الطول (سم)').fill('165');
  await field(page, 'الوزن (كجم)').fill('60');
  await field(page, 'محيط الخصر (سم)').fill('٧٢');
  // The illustration follows the form before anything is saved.
  await expect(avatar(page)).toHaveAttribute('data-height-cm', '165');
  await expect(page.getByTestId('body-profile-unsaved')).toBeVisible();

  await page.getByRole('button', { name: 'حفظ الملف' }).click();
  await expect(page.getByText('تم حفظ ملف المقاسات').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('completion-percent')).toHaveText('ملفك مكتمل بنسبة 40%');
  await expect(page.getByTestId('completion-next')).toHaveText(
    'أضف محيط الورك لتحسين اقتراحات المقاس.',
  );
  await expect(page.getByTestId('body-profile-unsaved')).toHaveCount(0);

  // Reload: everything is still there, the waist normalised to Latin digits.
  await page.reload({ waitUntil: 'networkidle' });
  await expect(choice(page, 'أنثى')).toHaveAttribute('aria-checked', 'true');
  await expect(field(page, 'الطول (سم)')).toHaveValue('165');
  await expect(field(page, 'محيط الخصر (سم)')).toHaveValue('72');

  // Edit a measurement.
  await field(page, 'محيط الورك (سم)').fill('98');
  await expect(page.getByTestId('completion-percent')).toHaveText('ملفك مكتمل بنسبة 47%');

  // Appearance — and the illustration follows every choice.
  await choice(page, 'حنطية').click();
  await expect(avatar(page)).toHaveAttribute('data-skin-tone', 'MEDIUM');
  await choice(page, 'حجاب / غطاء رأس').click();
  await expect(avatar(page)).toHaveAttribute('data-hair-style', 'COVERED');
  await expect(page.getByText('لا حاجة لاختيار لون الشعر مع غطاء الرأس.')).toBeVisible();
  await expect(avatar(page)).toHaveAttribute('data-glasses', 'none');
  await page.getByLabel('أرتدي نظارة').click();
  await choice(page, 'مستطيلة').click();
  await expect(avatar(page)).toHaveAttribute('data-glasses', 'RECTANGULAR');

  await page.getByRole('button', { name: 'حفظ الملف' }).click();
  await expect(page.getByText('تم حفظ ملف المقاسات').first()).toBeVisible({ timeout: 20_000 });
  // Choices stay chosen after saving (a form reset must not clear them).
  await expect(choice(page, 'حنطية')).toHaveAttribute('aria-checked', 'true');

  await page.reload({ waitUntil: 'networkidle' });
  await expect(field(page, 'محيط الورك (سم)')).toHaveValue('98');
  await expect(avatar(page)).toHaveAttribute('data-skin-tone', 'MEDIUM');
  await expect(avatar(page)).toHaveAttribute('data-hair-style', 'COVERED');
  await expect(avatar(page)).toHaveAttribute('data-glasses', 'RECTANGULAR');
  // Covered hair needs no colour, so appearance counts as complete.
  await expect(page.getByTestId('completion-percent')).toHaveText('ملفك مكتمل بنسبة 72%');
});

test('the English page reads left-to-right, and the profile survives signing out and back in', async ({
  page,
}) => {
  const email = await registerAndSignIn(page, 'en');
  await openProfile(page, 'en');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(page.getByRole('heading', { name: 'Fit profile', level: 2 })).toBeVisible();

  await saveEnglishMinimum(page);
  await choice(page, 'Short beard').click();
  await expect(avatar(page)).toHaveAttribute('data-facial-hair', 'SHORT_BEARD');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByText('Fit profile saved').first()).toBeVisible({ timeout: 20_000 });

  // Sign out: the page is gone with the session…
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL(/\/en$/);
  await page.goto(PAGE('en'));
  await expect(page).toHaveURL(/\/en\/account\/login$/);

  // …and back with a new one, exactly as saved.
  const login = page.locator('main form');
  await login.locator('input[name="email"]').fill(email);
  await login.locator('input[name="password"]').fill(PASSWORD);
  await login.locator('button[type="submit"]').click();
  await page.waitForURL(/\/en\/account$/, { timeout: 30_000 });
  await openProfile(page, 'en');
  await expect(field(page, 'Height (cm)')).toHaveValue('177');
  await expect(choice(page, 'Male')).toHaveAttribute('aria-checked', 'true');
  await expect(avatar(page)).toHaveAttribute('data-facial-hair', 'SHORT_BEARD');
});

test('validation: errors appear beside the fields, in the page language, and nothing is saved', async ({
  page,
}) => {
  await registerAndSignIn(page, 'en');
  await openProfile(page, 'en');

  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByTestId('body-profile-form-error')).toHaveText(
    'Check the highlighted fields, then save again.',
  );
  await expect(field(page, 'Height (cm)')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('This field is required.')).toHaveCount(4);
  // Focus lands on the first field to fix.
  await expect(choice(page, 'Female')).toBeFocused();

  await choice(page, 'Other').click();
  await field(page, 'Height (cm)').fill('0');
  await field(page, 'Weight (kg)').fill('abc');
  await field(page, 'Waist (cm)').fill('999');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByText('That looks too small — enter at least 50 cm.')).toBeVisible();
  await expect(page.getByText('Enter a number only, like 88 or 88.5.')).toBeVisible();
  await expect(page.getByText('That looks too large — enter at most 250 cm.')).toBeVisible();
  await expect(field(page, 'Height (cm)')).toBeFocused();

  await page.reload({ waitUntil: 'networkidle' });
  await expect(field(page, 'Height (cm)')).toHaveValue('');
  await expect(page.getByTestId('completion-percent')).toHaveText('Your profile is 0% complete');
});

test('deleting the profile removes it, after a confirmation', async ({ page }) => {
  await registerAndSignIn(page, 'en');
  await openProfile(page, 'en');
  await expect(page.getByRole('button', { name: 'Delete fit profile' })).toHaveCount(0);
  await saveEnglishMinimum(page);

  await page.getByRole('button', { name: 'Delete fit profile' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete your fit profile?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(field(page, 'Height (cm)')).toHaveValue('177');

  await page.getByRole('button', { name: 'Delete fit profile' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete permanently' }).click();
  await expect(page.getByText('Fit profile deleted').first()).toBeVisible({ timeout: 20_000 });
  await expect(field(page, 'Height (cm)')).toHaveValue('');

  await page.reload({ waitUntil: 'networkidle' });
  await expect(field(page, 'Height (cm)')).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Delete fit profile' })).toHaveCount(0);
});

async function newSignedInPage(browser: Browser, locale: 'ar' | 'en', tag: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await registerAndSignIn(page, locale, tag);
  return page;
}

test("one customer never sees another customer's measurements", async ({ browser }) => {
  const alice = await newSignedInPage(browser, 'en', 'alice');
  await openProfile(alice, 'en');
  await saveEnglishMinimum(alice, '188.5');

  const bob = await newSignedInPage(browser, 'en', 'bob');
  await openProfile(bob, 'en');
  await expect(field(bob, 'Height (cm)')).toHaveValue('');
  await expect(bob.getByTestId('completion-percent')).toHaveText('Your profile is 0% complete');
  expect(await bob.content()).not.toContain('188.5');

  // Bob saving changes only Bob's profile.
  await saveEnglishMinimum(bob, '160');
  await alice.reload({ waitUntil: 'networkidle' });
  await expect(field(alice, 'Height (cm)')).toHaveValue('188.5');

  await alice.context().close();
  await bob.context().close();
});

test('a save replayed from another origin is refused (CSRF), while the same request from the store works', async ({
  page,
}) => {
  await registerAndSignIn(page, 'en');
  await openProfile(page, 'en');
  await saveEnglishMinimum(page, '177');

  // Capture a real save — with the height changed — without letting it through.
  let captured: Request | null = null;
  await page.route('**/account/body-profile', async (route) => {
    if (route.request().method() === 'POST' && !captured) {
      captured = route.request();
      await route.abort();
      return;
    }
    await route.continue();
  });
  await field(page, 'Height (cm)').fill('150');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect.poll(() => captured !== null).toBe(true);
  await page.unroute('**/account/body-profile');
  const request = captured as unknown as Request;
  expect(request.headers()['next-action']).toBeTruthy();

  const headers = { ...request.headers() };
  delete headers['content-length'];
  delete headers['host'];

  // From a foreign origin: refused, and the profile is untouched.
  const forged = await page.request.post(request.url(), {
    headers: { ...headers, origin: 'https://attacker.example' },
    data: request.postDataBuffer() ?? undefined,
  });
  expect(forged.ok()).toBe(false);
  await openProfile(page, 'en');
  await expect(field(page, 'Height (cm)')).toHaveValue('177');

  // The identical request from the store's own origin goes through — so the
  // refusal above was the origin check, not a malformed replay.
  const genuine = await page.request.post(request.url(), {
    headers,
    data: request.postDataBuffer() ?? undefined,
  });
  expect(genuine.ok()).toBe(true);
  await openProfile(page, 'en');
  await expect(field(page, 'Height (cm)')).toHaveValue('150');
});

test.describe('mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const locale of ['ar', 'en'] as const) {
    test(`fits 390px without a horizontal scroll (${locale})`, async ({ page }) => {
      await registerAndSignIn(page, locale);
      await openProfile(page, locale);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `overflows by ${overflow}px`).toBeLessThanOrEqual(1);
      // The illustration comes first on a narrow screen, then the form.
      const previewBox = await page.getByTestId('avatar-preview').boundingBox();
      const saveBox = await page
        .getByRole('button', { name: locale === 'ar' ? 'حفظ الملف' : 'Save profile' })
        .boundingBox();
      expect(previewBox!.y).toBeLessThan(saveBox!.y);
    });
  }
});

test.describe('accessibility', () => {
  test('axe: Arabic, light theme, with a saved profile and the measuring guide open', async ({
    page,
  }) => {
    await registerAndSignIn(page, 'ar');
    await openProfile(page, 'ar');
    await axe(page);
    await choice(page, 'ذكر').click();
    await field(page, 'الطول (سم)').fill('177');
    await field(page, 'الوزن (كجم)').fill('82');
    await field(page, 'محيط الخصر (سم)').fill('88');
    await page.getByRole('button', { name: 'حفظ الملف' }).click();
    await expect(page.getByText('تم حفظ ملف المقاسات').first()).toBeVisible({ timeout: 20_000 });
    await axe(page);

    const trigger = page.getByRole('button', { name: 'كيف أقيس؟' });
    await trigger.click();
    await expect(page.getByRole('dialog', { name: 'كيف تأخذ مقاساتك' })).toBeVisible();
    await axe(page);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('axe: English, dark theme, with errors on screen', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('clothing-theme', 'dark'));
    await registerAndSignIn(page, 'en');
    await openProfile(page, 'en');
    await page.getByRole('button', { name: 'Save profile' }).click();
    await expect(page.getByTestId('body-profile-form-error')).toBeVisible();
    await axe(page);
  });

  test('keyboard: a choice group is one tab stop, moved through with the arrow keys', async ({
    page,
  }) => {
    await registerAndSignIn(page, 'en');
    await openProfile(page, 'en');
    await choice(page, 'Female').focus();
    // Held briefly, as a real key press is: Radix moves focus on a timeout
    // after keydown and selects only if the arrow key is still down then.
    await page.keyboard.press('ArrowRight', { delay: 60 });
    await expect(choice(page, 'Male')).toBeFocused();
    await expect(choice(page, 'Male')).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Tab');
    // Tab leaves the group rather than walking through every option.
    await expect(choice(page, 'Other')).not.toBeFocused();
    await expect(choice(page, 'Prefer not to say')).not.toBeFocused();
  });
});
