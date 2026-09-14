import { expect, test } from '@playwright/test';
import { callFromBrowser, storedCookie, storedCookieNames } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test.describe('Domain the browser cannot match', () => {
  test('is stripped, so the cookie is stored', async ({ page, context }) => {
    await callFromBrowser(page, '/api/relay?domain=.example.com');
    expect(await storedCookieNames(context)).toContain('access_token');
    expect((await storedCookie(context, 'access_token'))?.domain).toBe('dev.example.test');
  });

  test('is kept by the naive relay, and the browser silently discards the cookie', async ({
    page,
    context,
  }) => {
    const status = await callFromBrowser(page, '/api/relay?domain=.example.com&mode=raw');
    expect(status).toBe(200);
    expect(await storedCookieNames(context)).not.toContain('access_token');
  });
});

test.describe('Secure over plain http', () => {
  test('is stripped, so the cookie is stored', async ({ page, context }) => {
    await callFromBrowser(page, '/api/relay?secure=1');
    expect(await storedCookieNames(context)).toContain('access_token');
    expect((await storedCookie(context, 'access_token'))?.secure).toBe(false);
  });

  test('is kept by the naive relay, and the browser silently discards the cookie', async ({
    page,
    context,
  }) => {
    await callFromBrowser(page, '/api/relay?secure=1&mode=raw');
    expect(await storedCookieNames(context)).not.toContain('access_token');
  });
});

test.describe('SameSite None without Secure', () => {
  test('is downgraded to Lax, so the cookie is stored', async ({ page, context }) => {
    await callFromBrowser(page, '/api/relay?secure=1&samesite=none');
    const cookie = await storedCookie(context, 'access_token');
    expect(cookie).toBeDefined();
    expect(cookie?.sameSite).toBe('Lax');
    expect(cookie?.secure).toBe(false);
  });

  test('is left alone by the naive relay, and the browser silently discards the cookie', async ({
    page,
    context,
  }) => {
    await callFromBrowser(page, '/api/relay?samesite=none&mode=raw');
    expect(await storedCookieNames(context)).not.toContain('access_token');
  });
});

test('a cookie outside the allow list never reaches the browser', async ({ page, context }) => {
  await callFromBrowser(page, '/api/relay?domain=.example.com');
  expect(await storedCookieNames(context)).not.toContain('internal_trace');
});

test('the naive relay leaks the internal cookie, which is what the allow list prevents', async ({
  page,
  context,
}) => {
  await callFromBrowser(page, '/api/relay?mode=raw');
  expect(await storedCookieNames(context)).toContain('internal_trace');
});
