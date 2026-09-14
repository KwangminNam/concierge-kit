/** The fake backend, reporting which cookies actually reached it. */
export async function GET(request: Request): Promise<Response> {
  return Response.json({ cookie: request.headers.get('cookie') });
}
