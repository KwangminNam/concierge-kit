import type { BrowserContext, Page } from '@playwright/test';

/** Cookie names the browser actually stored, which is the only thing this suite trusts. */
export async function storedCookieNames(context: BrowserContext): Promise<string[]> {
  const cookies = await context.cookies();
  return cookies.map((cookie) => cookie.name).sort();
}

export async function storedCookie(context: BrowserContext, name: string) {
  return (await context.cookies()).find((cookie) => cookie.name === name);
}

/** Calls an endpoint from inside the page, so the browser decides what to store. */
export async function callFromBrowser(page: Page, path: string): Promise<number> {
  return page.evaluate(async (target) => {
    const response = await fetch(target, { credentials: 'same-origin' });
    return response.status;
  }, path);
}
