/** The fake backend, taking as long as asked and reporting the budget it was given. */
export async function GET(request: Request): Promise<Response> {
  const ms = Number(new URL(request.url).searchParams.get('ms') ?? '0');
  await new Promise((resolve) => setTimeout(resolve, ms));
  return Response.json({ deadline: request.headers.get('x-request-deadline') });
}
