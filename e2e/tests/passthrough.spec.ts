import { expect, test } from '@playwright/test';
import { storedCookieNames } from './helpers';

test('a passthrough route keeps status and body and still fixes the cookie', async ({
  page,
  context,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const response = await fetch('/api/passthrough?domain=.example.com&secure=1', {
      credentials: 'same-origin',
    });
    return { status: response.status, body: await response.json() };
  });

  expect(result.status).toBe(200);
  expect(result.body).toEqual({ ok: true, from: 'backend' });
  expect(await storedCookieNames(context)).toContain('access_token');
  expect(await storedCookieNames(context)).not.toContain('internal_trace');
});
