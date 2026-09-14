import { expect, test } from '@playwright/test';

test('the browser cookies the policy allows reach the backend, and the others do not', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(() => {
    // Setting it directly is the point here: this is the browser planting a cookie the policy
    // must refuse to forward.
    // eslint-disable-next-line unicorn/no-document-cookie
    document.cookie = 'theme=dark; path=/';
  });
  await page.evaluate(() =>
    fetch('/api/relay?domain=.example.com', { credentials: 'same-origin' }),
  );

  const seen = await page.evaluate(async () => {
    const response = await fetch('/api/whoami', { credentials: 'same-origin' });
    return (await response.json()) as { cookie: string | null };
  });

  expect(seen.cookie).toContain('access_token=granted');
  expect(seen.cookie).not.toContain('theme=dark');
});
