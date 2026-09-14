import { expect, test } from '@playwright/test';
import { storedCookie, storedCookieNames } from './helpers';

/**
 * The one thing no other call site can do.
 *
 * A route handler writes a cookie the browser sends back on the next request. A server action
 * has no response object. A server component render cannot write a cookie at all. Only this
 * layer can rotate a token and let the render happening right now read the new one.
 */

async function renderedToken(page: import('@playwright/test').Page): Promise<string | null> {
  const text = (await page.textContent('#seen-by-render')) ?? '{}';
  return (JSON.parse(text) as { accessToken: string | null }).accessToken;
}

test('the render reads a token the browser has never sent', async ({ page, context }) => {
  await context.addCookies([
    { name: 'refresh_token', value: 'valid', domain: 'dev.example.test', path: '/' },
  ]);

  await page.goto('/session');

  // The render saw the rotated token, on the very request that triggered the refresh.
  expect(await renderedToken(page)).toBe('rotated-by-proxy');

  // And the browser was told to store it, with the attributes fixed for this host.
  const stored = await storedCookie(context, 'access_token');
  expect(stored?.value).toBe('rotated-by-proxy');
  expect(stored?.domain).toBe('dev.example.test');
  expect(stored?.secure).toBe(false);
  expect(stored?.sameSite).toBe('Lax');
});

test('the allow list still applies to what the proxy relays', async ({ page, context }) => {
  await context.addCookies([
    { name: 'refresh_token', value: 'valid', domain: 'dev.example.test', path: '/' },
  ]);
  await page.goto('/session');

  expect(await storedCookieNames(context)).not.toContain('internal_trace');
});

test('nothing happens when there is no session to refresh', async ({ page, context }) => {
  await page.goto('/session');

  expect(await renderedToken(page)).toBeNull();
  expect(await storedCookieNames(context)).not.toContain('access_token');
});

test('a token the render already has is left alone', async ({ page, context }) => {
  await context.addCookies([
    { name: 'access_token', value: 'still-good', domain: 'dev.example.test', path: '/' },
    { name: 'refresh_token', value: 'valid', domain: 'dev.example.test', path: '/' },
  ]);
  await page.goto('/session');

  expect(await renderedToken(page)).toBe('still-good');
});

test('a refusal from the backend ends the session for this render too', async ({
  page,
  context,
}) => {
  await context.addCookies([
    { name: 'refresh_token', value: 'expired', domain: 'dev.example.test', path: '/' },
  ]);

  await page.goto('/session');

  expect(await renderedToken(page)).toBeNull();
  expect(await storedCookieNames(context)).not.toContain('refresh_token');
});
