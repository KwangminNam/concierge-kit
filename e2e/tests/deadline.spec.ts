import { expect, test } from '@playwright/test';

/**
 * One request, one time budget, shared by every backend call made while serving it.
 *
 * The proxy stamps the budget where the request enters, the render reads what is left, and the
 * backend is told how long it has. This is the pattern distributed systems call deadline
 * propagation, arriving at the frontend server layer.
 */
async function result(page: import('@playwright/test').Page) {
  const text = (await page.textContent('#result')) ?? '{}';
  return JSON.parse(text) as {
    aborted: boolean;
    reason?: string;
    remainingBefore?: number;
    backendSaw?: string | null;
  };
}

test('a fast backend answers, and was told how much budget it had', async ({ page }) => {
  await page.goto('/deadline?ms=100');
  const seen = await result(page);

  expect(seen.aborted).toBe(false);
  expect(seen.remainingBefore).toBeGreaterThan(0);
  expect(seen.remainingBefore).toBeLessThanOrEqual(1500);
  expect(Number(seen.backendSaw)).toBeGreaterThan(0);
  expect(Number(seen.backendSaw)).toBeLessThanOrEqual(seen.remainingBefore ?? 0);
});

test('a backend that would outlive the budget is cut off, and the page still renders', async ({
  page,
}) => {
  const started = Date.now();
  await page.goto('/deadline?ms=6000');
  const elapsed = Date.now() - started;
  const seen = await result(page);

  expect(seen.aborted).toBe(true);
  expect(['TimeoutError', 'AbortError']).toContain(seen.reason);
  expect(elapsed).toBeLessThan(4000);
});
