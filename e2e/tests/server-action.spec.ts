import { expect, test } from '@playwright/test';
import { storedCookie } from './helpers';

test('a server action stores the cookie through the cookie store', async ({ page, context }) => {
  await page.goto('/action');
  await page.click('#login');
  await expect
    .poll(async () => (await context.cookies()).map((cookie) => cookie.name))
    .toContain('access_token');

  const cookie = await storedCookie(context, 'access_token');
  expect(cookie?.domain).toBe('dev.example.test');
  expect(cookie?.secure).toBe(false);
  expect(cookie?.sameSite).toBe('Lax');
});

test('writing a cookie during a render is reported rather than crashing the page', async ({
  page,
  context,
}) => {
  await page.goto('/render-guard');
  const result = JSON.parse((await page.textContent('#result')) ?? '{}');

  expect(result.relayed).toEqual([]);
  expect(result.dropped).toContainEqual({ name: 'access_token', reason: 'unappliable' });
  expect((await context.cookies()).map((c) => c.name)).not.toContain('access_token');
});
