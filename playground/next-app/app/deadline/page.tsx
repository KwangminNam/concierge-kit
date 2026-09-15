import { BACKEND, relay } from '@/lib/relay';

export const dynamic = 'force-dynamic';

/**
 * One render, one budget. The proxy stamped it; this render spends it. A backend call that
 * would outlive it is aborted here, and the backend was told how long it had.
 */
export default async function DeadlinePage({
  searchParams,
}: {
  searchParams: Promise<{ ms?: string }>;
}) {
  const { ms = '100' } = await searchParams;
  const budget = await relay.deadline();

  try {
    const upstream = await fetch(`${BACKEND}/backend/slow?ms=${ms}`, {
      ...(await relay.forward()),
      cache: 'no-store',
    });
    const body = (await upstream.json()) as { deadline: string | null };
    return (
      <pre id="result">
        {JSON.stringify({
          aborted: false,
          remainingBefore: budget?.remaining,
          backendSaw: body.deadline,
        })}
      </pre>
    );
  } catch (error) {
    return (
      <pre id="result">
        {JSON.stringify({
          aborted: true,
          reason: (error as Error).name,
          remainingBefore: budget?.remaining,
        })}
      </pre>
    );
  }
}
