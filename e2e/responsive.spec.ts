import { test, expect, type Page } from '@playwright/test';

/* The regression gate for the defect this redesign exists to fix: both shells
 * were a fixed `grid-cols-[260px_1fr]` with no breakpoint, and 18 of 22 tables
 * had no overflow handling, so on a 390px viewport the content column was
 * ~130px wide and tables ran off the screen. */

const WIDTHS = [
  { width: 390, height: 844, label: 'phone' },
  { width: 768, height: 1024, label: 'tablet' },
  { width: 1440, height: 900, label: 'desktop' },
];

async function documentOverflow(page: Page) {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
}

for (const { width, height, label } of WIDTHS) {
  test(`no horizontal page overflow at ${width}px (${label})`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const { scrollWidth, clientWidth } = await documentOverflow(page);
    expect(
      scrollWidth,
      `page scrolls horizontally at ${width}px (${scrollWidth} > ${clientWidth})`,
    ).toBeLessThanOrEqual(clientWidth);
  });
}

test('a deliberately wide table scrolls inside itself, not the page', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // The scroll-mode table is far wider than the viewport by construction.
  const wide = page.getByRole('table', { name: 'Wide operator queue' });
  await expect(wide).toBeVisible();

  const box = await wide.boundingBox();
  expect(box!.width).toBeGreaterThan(390);

  // ...yet the document itself must not scroll sideways.
  const { scrollWidth, clientWidth } = await documentOverflow(page);
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
});

test('the bottom tab bar is visible on phones and hidden on desktop', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const tabbar = page.getByRole('navigation', { name: 'Primary' });
  await expect(tabbar).toBeVisible();

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(tabbar).toBeHidden();
});

test('the sidebar is hidden on phones and visible on desktop', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const sidebar = page.getByRole('navigation', { name: 'Main' });
  await expect(sidebar).toBeHidden();

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(sidebar).toBeVisible();
});

test('a data table renders as cards on a phone and as a table on desktop', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('table', { name: 'Recent orders' })).toHaveCount(0);

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByRole('table', { name: 'Recent orders' })).toBeVisible();
});

test('every interactive control meets the 44px tap target on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  const undersized = await page.evaluate(() => {
    const bad: string[] = [];
    for (const el of document.querySelectorAll('button, a[href], input, select')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue; // hidden
      if (r.height < 44) bad.push(`${el.tagName}.${el.className}`.slice(0, 80));
    }
    return bad;
  });

  expect(undersized, `controls under 44px tall: ${undersized.join(' | ')}`).toEqual([]);
});
